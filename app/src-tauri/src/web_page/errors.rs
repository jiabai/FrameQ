use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WebPageError {
    RequestInvalid,
    PrivateAddress,
    PlatformUnsupported,
    LoadFailed,
    BrowserFailed,
    Timeout,
    ResourceLimit,
    Cancelled,
    StorageFailed,
    AlreadyRunning,
}

impl WebPageError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::RequestInvalid => "WEB_REQUEST_INVALID",
            Self::PrivateAddress => "WEB_PRIVATE_ADDRESS",
            Self::PlatformUnsupported => "WEB_PLATFORM_UNSUPPORTED",
            Self::LoadFailed => "WEB_LOAD_FAILED",
            Self::BrowserFailed => "WEB_HOST_FAILED",
            Self::Timeout => "WEB_TIMEOUT",
            Self::ResourceLimit => "WEB_RESOURCE_LIMIT",
            Self::Cancelled => "WEB_CANCELLED",
            Self::StorageFailed => "WEB_STORAGE_FAILED",
            Self::AlreadyRunning => "WEB_ALREADY_RUNNING",
        }
    }
}

impl fmt::Display for WebPageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for WebPageError {}

pub(crate) type WebResult<T> = Result<T, WebPageError>;
