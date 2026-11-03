use frameq_webview_host::{lifecycle, protocol::{canonical_uuid, read_record, Identity, Input, Platform}};
use serde_json::json;
use std::io::BufReader;

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    if arguments.len() != 3 || arguments[1] != "--operation-id" || !canonical_uuid(&arguments[2]) {
        std::process::exit(2);
    }
    let mut reader = BufReader::new(std::io::stdin());
    let input = match read_record(&mut reader) {
        Ok(Some(input)) => input,
        _ => std::process::exit(2),
    };
    let Input::Init { operation_id, session_id, url, extraction_script, platform: Platform::Windows { user_data_dir }, deadline_ms, .. } = input else {
        std::process::exit(2);
    };
    let identity = Identity { operation_id, session_id };
    if identity.operation_id != arguments[2] { std::process::exit(2); }
    let (sender, receiver) = std::sync::mpsc::sync_channel(16);
    std::thread::spawn(move || loop {
        let record = read_record(&mut reader);
        let finished = !matches!(&record, Ok(Some(_)));
        if sender.send(record).is_err() || finished { break; }
    });
    let result = lifecycle::run(identity.clone(), url, extraction_script, user_data_dir, deadline_ms, receiver);
    match result {
        Ok(true) => (),
        Ok(false) => std::process::exit(1),
        Err(code) => {
            let _ = identity.emit(json!({"type":"error","code":code}));
            let _ = identity.emit(json!({"type":"closed","clean":false}));
            std::process::exit(1);
        }
    }
}
