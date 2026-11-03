use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use url::{Host, Url};

const INVALID_URL: &str = "WEB_URL_INVALID";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct WebPageSource {
    pub(crate) title: String,
    pub(crate) extracted_at: String,
}

impl WebPageSource {
    pub(crate) fn is_safe(&self) -> bool {
        !self.title.trim().is_empty()
            && self.title == self.title.trim()
            && self.title.chars().count() <= 512
            && !self.title.chars().any(char::is_control)
            && self.extracted_at.ends_with('Z')
            && time::OffsetDateTime::parse(
                &self.extracted_at,
                &time::format_description::well_known::Rfc3339,
            ).is_ok()
    }
}

pub(crate) fn validate_web_request_url(raw: &str) -> Result<Url, String> {
    if raw.chars().count() > 16384 || raw.trim() != raw || raw.chars().any(|ch| ch.is_control() || ch.is_whitespace()) || raw.contains('\\') {
        return Err(INVALID_URL.to_string());
    }
    let mut parsed = Url::parse(raw).map_err(|_| INVALID_URL.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !matches!(parsed.port_or_known_default(), Some(80 | 443))
    {
        return Err(INVALID_URL.to_string());
    }
    match parsed.host().ok_or_else(|| INVALID_URL.to_string())? {
        Host::Domain(domain) => {
            if domain.len() > 253
                || !domain.contains('.')
                || domain.ends_with('.')
                || domain.rsplit('.').next().is_some_and(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
                || ["localhost", "local", "internal", "test", "invalid", "example", "onion", "home", "arpa"].iter()
                    .any(|suffix| domain == *suffix || domain.ends_with(&format!(".{suffix}")))
                || domain.split('.').any(|label| label.is_empty() || label.len() > 63
                    || label.starts_with('-') || label.ends_with('-')
                    || !label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))
            {
                return Err(INVALID_URL.to_string());
            }
        }
        Host::Ipv4(address) if !public_literal(IpAddr::V4(address)) => return Err(INVALID_URL.to_string()),
        Host::Ipv6(address) if !public_literal(IpAddr::V6(address)) => return Err(INVALID_URL.to_string()),
        _ => {}
    }
    parsed.set_fragment(None);
    Ok(parsed)
}

pub(crate) fn public_literal(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !matches!(a, 0 | 10 | 127 | 224..=255)
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 169 && b == 254)
                && !(a == 172 && (16..=31).contains(&b))
                && !(a == 192 && (b == 168 || (b == 0 && matches!(c, 0 | 2)) || (b == 88 && c == 99)))
                && !(a == 198 && (matches!(b, 18 | 19) || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(address) => {
            let segments = address.segments();
            segments[0] & 0xe000 == 0x2000
                && !(segments[0] == 0x2001 && (segments[1] < 0x200 || segments[1] == 0xdb8))
                && !(segments[0] == 0x2002)
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}

pub(crate) fn canonical_web_url(raw: &str) -> Result<String, String> {
    let mut parsed = validate_web_request_url(raw)?;
    let items = parsed.query_pairs().collect::<Vec<_>>();
    if items.len() > 512 { return Err(INVALID_URL.to_string()); }
    let mut allowed = items.iter().filter_map(|(key, value)| {
        if items.iter().filter(|(candidate, _)| candidate == key).count() != 1 { return None; }
        let limit = match key.as_ref() {
            "id" | "article_id" | "post_id" | "story_id" => 20,
            "page" | "p" => 6,
            _ => return None,
        };
        if value.is_empty() || value.len() > limit || !value.bytes().all(|byte| byte.is_ascii_digit())
            || (matches!(key.as_ref(), "page" | "p") && value.starts_with('0'))
        {
            return None;
        }
        Some((key.to_string(), value.to_string()))
    }).collect::<Vec<_>>();
    allowed.sort();
    parsed.set_query(None);
    if !allowed.is_empty() {
        parsed.query_pairs_mut().extend_pairs(allowed);
    }
    Ok(parsed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_urls_preserve_only_numeric_identifiers() {
        assert_eq!(canonical_web_url("https://example.com/article?id=123&page=2&token=secret#part").unwrap(),
            "https://example.com/article?id=123&page=2");
        assert_eq!(canonical_web_url("https://example.com/?p=0&id=abc&post_id=0123").unwrap(),
            "https://example.com/?post_id=0123");
        assert_eq!(canonical_web_url("https://example.com/?id=1&id=2&p=02&story_id=4&article_id=3").unwrap(),
            "https://example.com/?article_id=3&story_id=4");
        for input in ["http://localhost/a", "http://127.0.0.1", "http://[::ffff:127.0.0.1]/", "http://192.0.2.3", "https://user:secret@example.com/", "https://example.com:444/", "file:///etc/passwd", "https://example.test/"] {
            assert!(validate_web_request_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn address_policy_rejects_special_use_and_mapped_ranges() {
        for input in ["0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.1.2", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.0.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:8.8.8.8", "::ffff:192.168.0.1", "64:ff9b::a00:1", "100::1", "2001:2::1", "2001:db8::1", "2002:7f00:1::", "3fff:fff::1", "fc00::1", "fe80::1", "ff02::1"] {
            assert!(!public_literal(input.parse().unwrap()), "{input}");
        }
        for input in ["1.1.1.1", "8.8.8.8", "100.128.0.1", "172.32.0.1", "2001:4860:4860::8888", "2606:4700:4700::1111"] {
            assert!(public_literal(input.parse().unwrap()), "{input}");
        }
    }
}
