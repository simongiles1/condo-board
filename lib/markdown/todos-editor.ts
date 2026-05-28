import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const todosTurndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});

todosTurndown.use(gfm);

todosTurndown.addRule("tiptapTaskItem", {
  filter: (node) =>
    node.nodeName === "LI" &&
    (node as HTMLElement).getAttribute("data-type") === "taskItem",
  replacement(content, node) {
    const element = node as HTMLElement;
    const checked = element.getAttribute("data-checked") === "true";
    const text = content.replace(/\n+/g, " ").trim();
    return `- [${checked ? "x" : " "}] ${text}`;
  },
});

/** Marked GFM HTML → structure TipTap task-list extensions accept. */
export function markdownToTodosEditorHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown) as string;

  if (typeof document === "undefined") {
    return rawHtml;
  }

  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  doc.querySelectorAll("ul").forEach((ul) => {
    const items = [...ul.children].filter(
      (node): node is HTMLLIElement => node.nodeName === "LI",
    );

    const isTaskList = items.some((li) =>
      li.querySelector('input[type="checkbox"]'),
    );

    if (!isTaskList) return;

    ul.setAttribute("data-type", "taskList");

    for (const li of items) {
      const input = li.querySelector('input[type="checkbox"]');
      const checked = input?.hasAttribute("checked") ?? false;

      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", checked ? "true" : "false");

      const text = li.textContent?.trim() ?? "";
      li.replaceChildren();
      const paragraph = doc.createElement("p");
      paragraph.textContent = text;
      li.appendChild(paragraph);
    }
  });

  return doc.body.innerHTML;
}

function unescapeTodoHeadingBrackets(markdown: string): string {
  return markdown.replace(/^### .+$/gm, (line) =>
    line.replace(/\\\[/g, "[").replace(/\\\]/g, "]"),
  );
}

/** TipTap HTML → constitution-style todos markdown. */
export function todosEditorHtmlToMarkdown(html: string): string {
  const md = todosTurndown.turndown(html);
  return unescapeTodoHeadingBrackets(md);
}
