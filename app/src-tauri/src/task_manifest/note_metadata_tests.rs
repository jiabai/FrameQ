use super::{normalize_display_title, NoteMetadataError};

#[test]
fn manual_titles_validate_unicode_and_trim_spaces() {
    assert_eq!(normalize_display_title("  我的笔记  ").unwrap(), "我的笔记");
    assert_eq!(normalize_display_title(&"🎬".repeat(60)).unwrap(), "🎬".repeat(60));
    for invalid in [
        "".to_string(), "  ".to_string(), "🎬".repeat(61), "\n标题".to_string(),
        "标题\r".to_string(), "标题\t".to_string(), "标题\0".to_string(),
        "隐藏\u{200b}字符".to_string(), "分隔\u{2028}字符".to_string(),
        "分隔\u{2029}字符".to_string(), "方向\u{202e}字符".to_string(),
    ] {
        assert_eq!(normalize_display_title(&invalid), Err(NoteMetadataError::TitleInvalid));
    }
}
