//! 不可信 HTML 剥离：DTO 只给 markdown / 纯文本，禁止把服务端 HTML 当可信内容。

/// 去掉标签并还原常见实体。输入不是 HTML 时原样返回（trim）。
pub fn html_to_text(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if !trimmed.contains('<') && !trimmed.contains('&') {
        return trimmed.to_string();
    }

    let mut out = String::with_capacity(trimmed.len());
    let mut in_tag = false;
    for ch in trimmed.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    unescape_entities(&out).trim().to_string()
}

/// 非空才返回；HTML 会先剥标签。
pub fn nonempty_text(input: &str) -> Option<String> {
    let text = html_to_text(input);
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Markdown 原文：空或明显是 HTML 片段时不当成 md。
pub fn markdown_or_none(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || looks_like_html(trimmed) {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn looks_like_html(input: &str) -> bool {
    let lower = input.trim_start().to_ascii_lowercase();
    lower.starts_with("<p")
        || lower.starts_with("<div")
        || lower.starts_with("<span")
        || lower.starts_with("<br")
        || lower.starts_with("<ul")
        || lower.starts_with("<ol")
        || lower.starts_with("<h1")
        || lower.starts_with("<h2")
        || lower.starts_with("<h3")
        || lower.starts_with("<article")
}

fn unescape_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_entities() {
        assert_eq!(html_to_text("<p>你好&nbsp;<b>世界</b></p>"), "你好 世界");
    }

    #[test]
    fn plain_text_unchanged() {
        assert_eq!(html_to_text("  hello  "), "hello");
    }

    #[test]
    fn markdown_rejects_html_fragment() {
        assert!(markdown_or_none("<p>hi</p>").is_none());
        assert_eq!(markdown_or_none("**hi**").as_deref(), Some("**hi**"));
    }
}
