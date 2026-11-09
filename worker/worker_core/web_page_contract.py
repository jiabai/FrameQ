from __future__ import annotations

import ipaddress
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from uuid import UUID

WEB_PAGE_CONTRACT_VERSION = 2
MAX_WEB_PAGE_MESSAGE_BYTES = 40 * 1024 * 1024
MAX_ARTICLE_TEXT_BYTES = 2 * 1024 * 1024
MAX_ARTICLE_MARKDOWN_BYTES = 4 * 1024 * 1024
_WEB_TASK_ID = re.compile(r"^[0-9]{8}-[0-9]{6}-web-[0-9a-f]{16}$")
_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def validate_web_url(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 16384:
        raise ValueError("Web page URL is invalid.")
    if any(unicodedata.category(char) == "Cc" or char.isspace() for char in value):
        raise ValueError("Web page URL is invalid.")
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or "\\" in value or parsed.port not in {None, 80, 443}):
        raise ValueError("Web page URL is invalid.")
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    forbidden_suffixes = {
        "localhost", "local", "internal", "invalid", "test", "example", "onion", "home", "arpa",
    }
    if host.endswith(".") or host.rsplit(".", 1)[-1] in forbidden_suffixes:
        raise ValueError("Web page host is invalid.")
    # DNS连接的实际地址仍须由原生代理逐次验证。
    if ":" in host or re.fullmatch(r"[0-9.]+", host):
        address = ipaddress.ip_address(host)
        if not address.is_global or (address.version == 6 and address.ipv4_mapped):
            raise ValueError("Web page address is unavailable.")
    elif (len(host) > 253 or "." not in host
          or any(not _HOST_LABEL.fullmatch(label) for label in host.split("."))
          or host.endswith((".local", ".localhost", ".internal", ".test", ".invalid"))
          or host.rsplit(".", 1)[1].isdigit()):
        raise ValueError("Web page host is invalid.")
    return value


def canonical_web_url(value: object) -> str:
    parsed = urlsplit(validate_web_url(value))
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = 80 if parsed.scheme == "http" else 443
    authority = host if parsed.port in {None, default_port} else f"{host}:{parsed.port}"
    query = []
    items = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=512)
    counts = {key: sum(1 for entry, _ in items if entry == key) for key, _ in items}
    for key, item in items:
        if counts[key] != 1:
            continue
        if (key in {"id", "article_id", "post_id", "story_id"}
                and re.fullmatch(r"[0-9]{1,20}", item)):
            query.append((key, item))
        elif key in {"page", "p"} and re.fullmatch(r"[1-9][0-9]{0,5}", item):
            query.append((key, item))
    path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
    # 已保存页面由浏览器URL解析器消除点路径；该形式不进入正式来源。
    if re.search(r"(?:^|/)(?:\.|%2e){1,2}(?:/|$)", path, re.IGNORECASE):
        path = urlsplit(urljoin(f"{parsed.scheme}://{authority}/", path)).path
        if re.search(r"(?:^|/)(?:\.|%2e){1,2}(?:/|$)", path, re.IGNORECASE):
            raise ValueError("Saved web page URL path is invalid.")
    return urlunsplit((parsed.scheme, authority, path, urlencode(sorted(query)), ""))


@dataclass(frozen=True)
class WebPageSource:
    url: str
    title: str
    extracted_at: str

    def __post_init__(self) -> None:
        if canonical_web_url(self.url) != self.url:
            raise ValueError("Saved web page URL is invalid.")
        if (not self.title.strip() or self.title != self.title.strip() or len(self.title) > 512
                or any(unicodedata.category(char) == "Cc" for char in self.title)):
            raise ValueError("Web page title is invalid.")
        timestamp_pattern = (
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z"
        )
        if re.fullmatch(timestamp_pattern, self.extracted_at) is None:
            raise ValueError("Web page extraction time is invalid.")
        parsed = datetime.fromisoformat(self.extracted_at.replace("Z", "+00:00"))
        if not self.extracted_at.endswith("Z") or parsed.utcoffset().total_seconds() != 0:
            raise ValueError("Web page extraction time is invalid.")

    def to_dict(self) -> dict[str, str]:
        return {"kind": "web_page", "url": self.url, "title": self.title,
                "extractedAt": self.extracted_at}


@dataclass(frozen=True)
class WebPageRequest:
    operation_id: str
    task_id: str
    article: dict[str, str] = field(repr=False)


def validate_web_task_id(value: object) -> str:
    if not isinstance(value, str) or _WEB_TASK_ID.fullmatch(value) is None:
        raise ValueError("Web page task identity is invalid.")
    return value


def parse_web_page_request(payload: object) -> WebPageRequest:
    if (not isinstance(payload, dict) or set(payload) != {
        "contract_version", "operation_id", "task_id", "article"
    } or type(payload["contract_version"]) is not int
            or payload["contract_version"] != WEB_PAGE_CONTRACT_VERSION):
        raise ValueError("Web page request is invalid.")
    operation = payload["operation_id"]
    if not isinstance(operation, str) or str(UUID(operation)) != operation:
        raise ValueError("Web page operation identity is invalid.")
    return WebPageRequest(operation, validate_web_task_id(payload["task_id"]),
                          validate_article_payload(payload["article"]))


def validate_article_payload(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict) or set(payload) != {"title", "text", "markdown", "sourceUrl"}:
        raise ValueError("Web page extraction is invalid.")
    if any(not isinstance(value, str) for value in payload.values()):
        raise ValueError("Web page extraction is invalid.")
    if (not payload["title"].strip() or payload["title"] != payload["title"].strip()
            or len(payload["title"]) > 512
            or any(unicodedata.category(char) == "Cc" for char in payload["title"])
            or len("".join(payload["text"].split())) < 50
            or not payload["markdown"].strip()
            or len(payload["text"].encode("utf-8")) > MAX_ARTICLE_TEXT_BYTES
            or len(payload["markdown"].encode("utf-8")) > MAX_ARTICLE_MARKDOWN_BYTES
            or canonical_web_url(payload["sourceUrl"]) != payload["sourceUrl"]):
        raise ValueError("Web page extraction is invalid.")
    return payload
