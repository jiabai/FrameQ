use super::errors::{WebPageError, WebResult};
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::header::{CONNECTION, HOST, PROXY_AUTHENTICATE, PROXY_AUTHORIZATION};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::task::{Context, Poll};
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio_util::task::TaskTracker;
use url::{Host, Url};

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type ProxyBody = BoxBody<Bytes, BoxError>;
const MAX_NETWORK_BYTES: u64 = 64 * 1024 * 1024;
const TUNNEL_IDLE_LIMIT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub(crate) struct ProxyState {
    transferred: AtomicU64,
    failed: AtomicBool,
    exhausted: AtomicBool,
    diagnostics: Mutex<Vec<(&'static str, &'static str)>>,
}

impl ProxyState {
    fn diagnose(&self, reason: &'static str) {
        let mut diagnostics = self.diagnostics.lock().expect("proxy diagnostic lock");
        if diagnostics.len() < 16 { diagnostics.push((reason, "connection")); }
    }

    pub(crate) fn take_diagnostics(&self) -> Vec<(&'static str, &'static str)> {
        std::mem::take(&mut *self.diagnostics.lock().expect("proxy diagnostic lock"))
    }

    pub(crate) fn failure(&self) -> Option<WebPageError> {
        if self.exhausted.load(Ordering::Acquire) { Some(WebPageError::ResourceLimit) }
        else if self.failed.load(Ordering::Acquire) { Some(WebPageError::LoadFailed) }
        else { None }
    }

    fn charge(&self, count: usize) -> io::Result<()> {
        let total = self.transferred.fetch_add(count as u64, Ordering::AcqRel) + count as u64;
        if total > MAX_NETWORK_BYTES {
            if !self.exhausted.swap(true, Ordering::AcqRel) { self.diagnose("byte_limit"); }
            Err(io::Error::other("WEB_RESOURCE_LIMIT"))
        } else { Ok(()) }
    }
}

pub(crate) struct PublicProxy {
    address: SocketAddr,
    stop: watch::Sender<bool>,
    thread: Option<JoinHandle<()>>,
    pub(crate) state: Arc<ProxyState>,
}

impl PublicProxy {
    pub(crate) fn start() -> WebResult<Self> {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| WebPageError::LoadFailed)?;
        listener.set_nonblocking(true).map_err(|_| WebPageError::LoadFailed)?;
        let address = listener.local_addr().map_err(|_| WebPageError::LoadFailed)?;
        let (stop, receiver) = watch::channel(false);
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let state = Arc::new(ProxyState::default());
        let worker_state = Arc::clone(&state);
        let thread = std::thread::Builder::new().name("web-public-proxy".into()).spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build();
            let Ok(runtime) = runtime else { let _ = ready_sender.send(false); return; };
            runtime.block_on(async move {
                let listener = TcpListener::from_std(listener);
                let Ok(listener) = listener else { let _ = ready_sender.send(false); return; };
                let _ = ready_sender.send(true);
                serve(listener, receiver, worker_state).await;
            });
        }).map_err(|_| WebPageError::LoadFailed)?;
        if ready_receiver.recv_timeout(Duration::from_secs(5)) != Ok(true) {
            stop.send_replace(true);
            let _ = thread.join();
            return Err(WebPageError::LoadFailed);
        }
        Ok(Self { address, stop, thread: Some(thread), state })
    }

    pub(crate) fn url(&self) -> String { format!("http://{}", self.address) }

    pub(crate) fn stop(&mut self) -> WebResult<()> {
        self.stop.send_replace(true);
        if let Some(thread) = self.thread.take() {
            thread.join().map_err(|_| WebPageError::LoadFailed)?;
        }
        Ok(())
    }
}

impl Drop for PublicProxy {
    fn drop(&mut self) { let _ = self.stop(); }
}

async fn serve(listener: TcpListener, mut stop: watch::Receiver<bool>, state: Arc<ProxyState>) {
    let tasks = TaskTracker::new();
    let capacity = Arc::new(Semaphore::new(16));
    loop {
        let permit = tokio::select! {
            biased;
            _ = stop.changed() => break,
            permit = Arc::clone(&capacity).acquire_owned() => permit.expect("proxy capacity remains open"),
        };
        tokio::select! {
            biased;
            _ = stop.changed() => break,
            accepted = listener.accept() => {
                let Ok((socket, peer)) = accepted else { state.failed.store(true, Ordering::Release); break; };
                if !peer.ip().is_loopback() { continue; }
                let permit = Arc::new(permit);
                let state = Arc::clone(&state);
                let receiver = stop.clone();
                let tracker = tasks.clone();
                tasks.spawn(async move {
                    let connection_permit = Arc::clone(&permit);
                    let io = TokioIo::new(BudgetedStream::new(socket, Arc::clone(&state)));
                    let mut connection_stop = receiver.clone();
                    let service = service_fn(move |request| handle(request, receiver.clone(), Arc::clone(&state), tracker.clone(), Arc::clone(&permit)));
                    let mut builder = hyper::server::conn::http1::Builder::new();
                    builder.max_buf_size(16 * 1024);
                    tokio::select! {
                        _ = builder.serve_connection(io, service).with_upgrades() => {},
                        _ = connection_stop.changed() => {},
                    }
                    drop(connection_permit);
                });
            }
        }
    }
    drop(listener);
    tasks.close();
    tasks.wait().await;
}

async fn public_target(url: &Url) -> WebResult<SocketAddr> {
    let port = url.port_or_known_default().ok_or(WebPageError::RequestInvalid)?;
    if !matches!(port, 80 | 443) { return Err(WebPageError::RequestInvalid); }
    let addresses: Vec<SocketAddr> = match url.host().ok_or(WebPageError::RequestInvalid)? {
        Host::Ipv4(ip) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Host::Ipv6(ip) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Host::Domain(host) => tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, port)))
            .await.map_err(|_| WebPageError::Timeout)?.map_err(|_| WebPageError::LoadFailed)?.collect(),
    };
    if addresses.is_empty() { return Err(WebPageError::LoadFailed); }
    if addresses.iter().any(|address| !crate::task_manifest::is_public_web_address(address.ip())) {
        return Err(WebPageError::PrivateAddress);
    }
    Ok(addresses[0])
}

async fn connect_public(url: &Url, state: &ProxyState) -> WebResult<TcpStream> {
    let address = public_target(url).await.map_err(|error| {
        state.diagnose(match error {
            WebPageError::PrivateAddress | WebPageError::RequestInvalid => "blocked_url",
            WebPageError::Timeout => "dns_timeout",
            _ => "dns_failed",
        });
        error
    })?;
    tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(address)).await
        .map_err(|_| { state.diagnose("connection_timeout"); WebPageError::Timeout })?
        .map_err(|_| { state.diagnose("connection_failed"); WebPageError::LoadFailed })
}

fn failure(status: StatusCode, code: &'static str) -> Response<ProxyBody> {
    let body = Full::new(Bytes::from_static(code.as_bytes())).map_err(|never| -> BoxError { match never {} }).boxed();
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
}

async fn handle(
    mut request: Request<Incoming>, mut stop: watch::Receiver<bool>, state: Arc<ProxyState>, tasks: TaskTracker,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Response<ProxyBody>, Infallible> {
    if *stop.borrow() {
        return Ok(failure(StatusCode::SERVICE_UNAVAILABLE, "WEB_CANCELLED"));
    }
    if let Some(error) = state.failure() {
        return Ok(failure(StatusCode::SERVICE_UNAVAILABLE, error.code()));
    }
    let is_tunnel = request.method() == Method::CONNECT;
    let target = if is_tunnel {
        request.uri().authority().and_then(|authority| Url::parse(&format!("https://{authority}/")).ok())
    } else { Url::parse(&request.uri().to_string()).ok() };
    let Some(target) = target else {
        state.diagnose("blocked_url");
        return Ok(failure(StatusCode::BAD_REQUEST, "WEB_REQUEST_INVALID"));
    };
    if crate::task_manifest::validate_web_request_url(target.as_str()).is_err()
        || (!is_tunnel && target.scheme() != "http")
        || (!is_tunnel && !matches!(*request.method(), Method::GET | Method::HEAD | Method::POST | Method::OPTIONS))
    {
        state.diagnose("blocked_url");
        return Ok(failure(StatusCode::FORBIDDEN, "WEB_REQUEST_INVALID"));
    }
    let upstream = tokio::select! {
        result = connect_public(&target, &state) => result,
        _ = stop.changed() => return Ok(failure(StatusCode::SERVICE_UNAVAILABLE, "WEB_CANCELLED")),
    };
    let upstream = match upstream {
        Ok(upstream) => upstream,
        Err(error) => return Ok(failure(StatusCode::FORBIDDEN, error.code())),
    };
    if is_tunnel {
        let upgrade = hyper::upgrade::on(&mut request);
        tasks.spawn(async move {
            let _permit = permit;
            let upgraded = tokio::select! {
                result = upgrade => result,
                _ = stop.changed() => return,
            };
            if let Ok(upgraded) = upgraded {
                let activity = Arc::new(Mutex::new(tokio::time::Instant::now()));
                let mut client = TokioIo::new(upgraded);
                let mut upstream = BudgetedStream::new(upstream, state).with_activity(Arc::clone(&activity));
                tokio::select! {
                    _ = tokio::io::copy_bidirectional(&mut client, &mut upstream) => {},
                    _ = stop.changed() => {},
                    _ = wait_for_tunnel_idle(activity) => {},
                }
            }
        });
        return Ok(failure(StatusCode::OK, ""));
    }
    request.headers_mut().remove(PROXY_AUTHORIZATION);
    request.headers_mut().remove(PROXY_AUTHENTICATE);
    request.headers_mut().remove(CONNECTION);
    request.headers_mut().remove("proxy-connection");
    let authority = target[url::Position::BeforeHost..url::Position::AfterPort].to_owned();
    let Ok(host) = authority.parse() else { return Ok(failure(StatusCode::BAD_REQUEST, "WEB_REQUEST_INVALID")); };
    request.headers_mut().insert(HOST, host);
    let mut uri = request.uri().clone().into_parts();
    uri.scheme = None; uri.authority = None;
    let Ok(uri) = hyper::Uri::from_parts(uri) else { return Ok(failure(StatusCode::BAD_REQUEST, "WEB_REQUEST_INVALID")); };
    *request.uri_mut() = uri;
    let io = TokioIo::new(BudgetedStream::new(upstream, state));
    let handshake = tokio::select! {
        result = hyper::client::conn::http1::handshake::<_, Incoming>(io) => result,
        _ = stop.changed() => return Ok(failure(StatusCode::SERVICE_UNAVAILABLE, "WEB_CANCELLED")),
    };
    let Ok((mut sender, connection)) = handshake else { return Ok(failure(StatusCode::BAD_GATEWAY, "WEB_LOAD_FAILED")); };
    let mut connection_stop = stop.clone();
    tasks.spawn(async move {
        let _permit = permit;
        tokio::select! { _ = connection => {}, _ = connection_stop.changed() => {} }
    });
    let response = tokio::select! {
        result = sender.send_request(request) => result,
        _ = stop.changed() => return Ok(failure(StatusCode::SERVICE_UNAVAILABLE, "WEB_CANCELLED")),
    };
    Ok(match response {
        Ok(response) => response.map(|body| body.map_err(|error| Box::new(error) as BoxError).boxed()),
        Err(_) => failure(StatusCode::BAD_GATEWAY, "WEB_LOAD_FAILED"),
    })
}

async fn wait_for_tunnel_idle(activity: Arc<Mutex<tokio::time::Instant>>) {
    loop {
        let deadline = *activity.lock().expect("tunnel activity lock") + TUNNEL_IDLE_LIMIT;
        tokio::time::sleep_until(deadline).await;
        if activity.lock().expect("tunnel activity lock").elapsed() >= TUNNEL_IDLE_LIMIT { return; }
    }
}

struct BudgetedStream {
    stream: TcpStream,
    state: Arc<ProxyState>,
    activity: Option<Arc<Mutex<tokio::time::Instant>>>,
}
impl BudgetedStream {
    fn new(stream: TcpStream, state: Arc<ProxyState>) -> Self { Self { stream, state, activity: None } }

    fn with_activity(mut self, activity: Arc<Mutex<tokio::time::Instant>>) -> Self {
        self.activity = Some(activity);
        self
    }

    fn transferred(&self, bytes: usize) {
        if bytes > 0 {
            if let Some(activity) = &self.activity {
                *activity.lock().expect("tunnel activity lock") = tokio::time::Instant::now();
            }
        }
    }
}
impl AsyncRead for BudgetedStream {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buffer: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let before = buffer.filled().len();
        match Pin::new(&mut self.stream).poll_read(cx, buffer) {
            Poll::Ready(Ok(())) => {
                let bytes = buffer.filled().len() - before;
                self.transferred(bytes);
                Poll::Ready(self.state.charge(bytes))
            }
            result => result,
        }
    }
}
impl AsyncWrite for BudgetedStream {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buffer: &[u8]) -> Poll<io::Result<usize>> {
        let result = Pin::new(&mut self.stream).poll_write(cx, buffer);
        if let Poll::Ready(Ok(bytes)) = result { self.transferred(bytes); }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    async fn public_tunnel(address: SocketAddr) -> Result<hyper::upgrade::Upgraded, BoxError> {
        let socket = TcpStream::connect(address).await?;
        let (mut sender, connection) = hyper::client::conn::http1::handshake::<_, Full<Bytes>>(
            TokioIo::new(socket),
        ).await?;
        tokio::spawn(async move { let _ = connection.with_upgrades().await; });
        let response = sender.send_request(Request::builder()
            .method(Method::CONNECT).uri("www.baidu.com:443")
            .header(HOST, "www.baidu.com:443")
            .body(Full::new(Bytes::new()))?).await?;
        if response.status() != StatusCode::OK {
            return Err(io::Error::other(format!("CONNECT status {}", response.status())).into());
        }
        Ok(hyper::upgrade::on(response).await?)
    }

    #[test]
    fn proxy_rejects_private_targets_without_connecting_and_closes_listener() {
        let canary = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        canary.set_nonblocking(true).unwrap();
        let mut proxy = PublicProxy::start().unwrap();
        let mut client = std::net::TcpStream::connect(proxy.address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(client, "CONNECT {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", canary.local_addr().unwrap(), canary.local_addr().unwrap()).unwrap();
        let mut response = [0; 1024];
        let count = client.read(&mut response).unwrap();
        assert!(std::str::from_utf8(&response[..count]).unwrap().starts_with("HTTP/1.1 403"));
        assert_eq!(canary.accept().unwrap_err().kind(), io::ErrorKind::WouldBlock);
        drop(client);
        proxy.stop().unwrap();
        assert!(std::net::TcpStream::connect(proxy.address).is_err());
    }

    #[test]
    fn rejected_subresources_do_not_exhaust_the_whole_proxy_after_one_hundred_requests() {
        let mut proxy = PublicProxy::start().unwrap();
        for _ in 0..125 {
            let mut client = std::net::TcpStream::connect(proxy.address).unwrap();
            client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            write!(client, "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\nConnection: close\r\n\r\n").unwrap();
            let mut response = [0; 1024];
            let count = client.read(&mut response).unwrap();
            assert!(std::str::from_utf8(&response[..count]).unwrap().starts_with("HTTP/1.1 403"));
            assert_eq!(proxy.state.failure(), None);
        }
        proxy.stop().unwrap();
    }

    #[test]
    fn saturated_proxy_waits_for_capacity_and_stop_releases_waiters() {
        let mut proxy = PublicProxy::start().unwrap();
        let mut clients = Vec::new();
        for _ in 0..16 {
            let client = std::net::TcpStream::connect(proxy.address).unwrap();
            client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            clients.push(client);
        }
        let mut waiting = std::net::TcpStream::connect(proxy.address).unwrap();
        waiting.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
        write!(waiting, "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\nConnection: close\r\n\r\n").unwrap();
        let mut response = [0; 1024];
        let pending = waiting.read(&mut response).unwrap_err();
        assert!(matches!(pending.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut));
        drop(clients.pop());
        waiting.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let count = waiting.read(&mut response).unwrap();
        assert!(std::str::from_utf8(&response[..count]).unwrap().starts_with("HTTP/1.1 403"));
        drop(waiting);
        let client = std::net::TcpStream::connect(proxy.address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        clients.push(client);
        let mut cancelled = std::net::TcpStream::connect(proxy.address).unwrap();
        cancelled.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let began = std::time::Instant::now();
        proxy.stop().unwrap();
        assert!(began.elapsed() < Duration::from_secs(5));
        let result = cancelled.read(&mut response);
        assert!(matches!(result, Ok(0)) || result.is_err());
        for mut client in clients {
            assert_eq!(client.read(&mut response).unwrap(), 0);
        }
    }

    #[test]
    fn proxy_byte_budget_retains_resource_limit_and_bounded_private_diagnostics() {
        let mut proxy = PublicProxy::start().unwrap();
        proxy.state.charge(MAX_NETWORK_BYTES as usize).unwrap();
        assert_eq!(proxy.state.failure(), None);
        assert!(proxy.state.charge(1).is_err());
        assert_eq!(proxy.state.failure(), Some(WebPageError::ResourceLimit));
        let mut client = std::net::TcpStream::connect(proxy.address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(client, "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\nConnection: close\r\n\r\n").unwrap();
        let mut response = String::new();
        let read = client.read_to_string(&mut response);
        assert!(read.is_err() || response.is_empty());
        assert_eq!(proxy.state.failure(), Some(WebPageError::ResourceLimit));
        assert_eq!(proxy.state.take_diagnostics(), [("byte_limit", "connection")]);
        proxy.stop().unwrap();
    }

    #[test]
    #[ignore = "requires real public TCP connections to www.baidu.com:443"]
    fn public_connect_tunnels_hold_capacity_until_closed_and_stop_closes_every_tunnel() {
        let mut proxy = PublicProxy::start().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let mut tunnels = Vec::new();
            for _ in 0..16 {
                tunnels.push(tokio::time::timeout(Duration::from_secs(15), public_tunnel(proxy.address)).await.unwrap().unwrap());
            }
            assert!(tokio::time::timeout(Duration::from_millis(300), public_tunnel(proxy.address)).await.is_err());
            let closed = tunnels.pop().unwrap().downcast::<TokioIo<TcpStream>>().unwrap();
            #[allow(deprecated)]
            closed.io.inner().set_linger(Some(Duration::ZERO)).unwrap();
            drop(closed);
            tokio::time::sleep(Duration::from_millis(100)).await;
            tunnels.push(tokio::time::timeout(Duration::from_secs(15), public_tunnel(proxy.address)).await.unwrap().unwrap());

            proxy.stop().unwrap();
            for tunnel in tunnels {
                let mut client = TokioIo::new(tunnel);
                let mut byte = [0; 1];
                let read = tokio::time::timeout(Duration::from_secs(5), tokio::io::AsyncReadExt::read(&mut client, &mut byte)).await.unwrap();
                assert!(matches!(read, Ok(0)) || read.is_err());
            }
            assert!(TcpStream::connect(proxy.address).await.is_err());
        });
    }

    #[test]
    #[ignore = "requires real public TCP connections to www.baidu.com:443"]
    fn idle_public_tunnels_release_capacity_for_queued_connections() {
        let mut proxy = PublicProxy::start().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let mut tunnels = Vec::new();
            for _ in 0..16 {
                tunnels.push(tokio::time::timeout(Duration::from_secs(15), public_tunnel(proxy.address)).await.unwrap().unwrap());
            }
            let queued = tokio::time::timeout(Duration::from_secs(8), public_tunnel(proxy.address)).await
                .expect("idle tunnel budget must release capacity before task deadline").unwrap();
            tunnels.push(queued);
            assert_eq!(proxy.state.failure(), None);
            proxy.stop().unwrap();
            for tunnel in tunnels {
                let mut client = TokioIo::new(tunnel);
                let mut byte = [0; 1];
                let read = tokio::time::timeout(Duration::from_secs(5), tokio::io::AsyncReadExt::read(&mut client, &mut byte)).await.unwrap();
                assert!(matches!(read, Ok(0)) || read.is_err());
            }
        });
    }
}
