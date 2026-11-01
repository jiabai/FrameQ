from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from frameq_worker.output_language import OutputLanguage, is_output_language

NoteTitleStatus = Literal["generating", "completed", "failed", "cancelled"]
_FIELDS = {"text", "status", "output_language", "error_code"}
_SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def validate_note_title(text: object) -> str:
    if (
        not isinstance(text, str)
        or not text
        or text != text.strip()
        or len(text) > 60
        or any(
            unicodedata.category(character) in {"Cc", "Cf", "Cs", "Zl", "Zp"}
            for character in text
        )
    ):
        raise ValueError("Note title is invalid.")
    return text


@dataclass(frozen=True)
class NoteTitleMetadata:
    text: str | None
    status: NoteTitleStatus
    output_language: OutputLanguage
    error_code: str | None

    def __post_init__(self) -> None:
        if self.text is not None:
            validate_note_title(self.text)
        if (
            not isinstance(self.status, str)
            or self.status not in {"generating", "completed", "failed", "cancelled"}
            or not is_output_language(self.output_language)
        ):
            raise ValueError("Note title metadata is invalid.")
        if self.status in {"generating", "completed"}:
            if self.error_code is not None or (self.status == "completed" and self.text is None):
                raise ValueError("Note title metadata is invalid.")
        elif not isinstance(self.error_code, str) or _SAFE_CODE.fullmatch(self.error_code) is None:
            raise ValueError("Note title metadata is invalid.")

    def to_dict(self) -> dict[str, object]:
        return {
            "text": self.text, "status": self.status,
            "output_language": self.output_language, "error_code": self.error_code,
        }


def parse_note_title_metadata(payload: object) -> NoteTitleMetadata:
    if not isinstance(payload, dict) or set(payload) != _FIELDS:
        raise ValueError("Note title metadata is invalid.")
    return NoteTitleMetadata(
        payload["text"], payload["status"], payload["output_language"], payload["error_code"],
    )
