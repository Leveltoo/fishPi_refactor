//! HTML 处理：列表预览等可剥标签；详情正文 / 评论 / 清风明月走 [`keep_renderable`]。

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

/// 私聊等需要前端净化渲染的正文：保留原文（含 HTML/md），空则 None。
/// 不要用 [`html_to_text`]，剥标签会丢掉图和链接。
pub fn keep_renderable(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 正文拆成 markdown 或 HTML，互斥；不要剥标签。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichBody {
    pub markdown: Option<String>,
    pub html: Option<String>,
}

pub fn split_rich_body(input: &str) -> RichBody {
    let Some(trimmed) = keep_renderable(input) else {
        return RichBody {
            markdown: None,
            html: None,
        };
    };
    if looks_like_html(&trimmed) {
        RichBody {
            markdown: None,
            html: Some(trimmed),
        }
    } else {
        RichBody {
            markdown: Some(trimmed),
            html: None,
        }
    }
}

pub fn looks_like_html(input: &str) -> bool {
    let lower = input.to_ascii_lowercase();
    contains_tag(&lower, "p")
        || contains_tag(&lower, "div")
        || contains_tag(&lower, "span")
        || contains_tag(&lower, "br")
        || contains_tag(&lower, "img")
        || contains_tag(&lower, "a")
        || contains_tag(&lower, "ul")
        || contains_tag(&lower, "ol")
        || contains_tag(&lower, "li")
        || contains_tag(&lower, "h1")
        || contains_tag(&lower, "h2")
        || contains_tag(&lower, "h3")
        || contains_tag(&lower, "blockquote")
        || contains_tag(&lower, "pre")
        || contains_tag(&lower, "code")
        || contains_tag(&lower, "table")
        || contains_tag(&lower, "article")
        || contains_tag(&lower, "iframe")
}

fn contains_tag(lower: &str, name: &str) -> bool {
    lower.contains(&format!("<{name}")) || lower.contains(&format!("</{name}>"))
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
        assert!(markdown_or_none("<iframe src=\"//music.163.com/x\"></iframe>").is_none());
        assert_eq!(markdown_or_none("**hi**").as_deref(), Some("**hi**"));
    }

    #[test]
    fn keep_renderable_preserves_html() {
        assert_eq!(
            keep_renderable("<p><img src=\"https://a/b.png\"></p>").as_deref(),
            Some("<p><img src=\"https://a/b.png\"></p>")
        );
        assert!(keep_renderable("  ").is_none());
    }

    #[test]
    fn html_with_mid_sentence_image_is_html() {
        let html = "看图 <img src=\"https://a.test/x.png\">";
        assert!(looks_like_html(html));
        assert_eq!(split_rich_body(html).html.as_deref(), Some(html));
        assert!(split_rich_body(html).markdown.is_none());
    }
}
