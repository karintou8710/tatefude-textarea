import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useEffect, useRef } from "react";
import type { WritingMode } from "tatefude-textarea";
import type { TextareaHandle } from "tatefude-textarea-react";
import styles from "./SelectionToolbar.module.css";

interface Props {
  editor: TextareaHandle | null;
  writingMode: WritingMode;
  /** 何か選ばれているか。選択が変わるたびに変える */
  selection: { anchor: number; focus: number };
}

/**
 * 選択中に出る編集メニュー。
 *
 * OS の編集メニューは web から呼べないので自前で出す。本文の上に固定で重ねると
 * 縦書きでは見えている全部の列の末尾が隠れるので、選択の脇に浮かせる。
 */
export function SelectionToolbar({ editor, writingMode, selection }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = selection.anchor !== selection.focus;

  useEffect(() => {
    const menu = menuRef.current;
    const container = editor?.editor?.container;
    // 選択が変われば矩形も変わる。autoUpdate は送りと寸法しか見ないので、
    // 選択そのものは依存に入れて置き直す
    if (!menu || !container || selection.anchor === selection.focus) return;

    // 選択は要素ではないので、矩形だけを持つ仮想要素として渡す
    const anchor = {
      getBoundingClientRect: () => {
        const box = container.getBoundingClientRect();
        const rect = editor?.selectionRect;
        if (!rect) return new DOMRect(box.x, box.y, 0, 0);
        return new DOMRect(box.x + rect.x, box.y + rect.y, rect.width, rect.height);
      },
    };

    const place = async () => {
      const vertical = writingMode === "vertical-rl";
      const { x, y } = await computePosition(anchor, menu, {
        // CSS は fixed。ここを合わせないと offsetParent 基準で計算される
        strategy: "fixed",
        // 縦書きは読み進む側 (左) に出したいが、横長のメニューは
        // 画面の幅に入らないことが多い。入らなければ右、それも駄目なら上下
        placement: vertical ? "left" : "top",
        middleware: [
          offset(8),
          flip({ fallbackPlacements: vertical ? ["right", "top", "bottom"] : ["bottom"] }),
          shift({ padding: 8, boundary: visibleArea() }),
        ],
      });
      Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
    };

    return autoUpdate(anchor, menu, place);
  }, [editor, writingMode, selection]);

  if (!editor || !shown) return null;

  const copy = async () => {
    await writeClipboard(editor.selectedText);
  };

  const cut = async () => {
    const text = editor.cut();
    if (text) await writeClipboard(text);
  };

  const paste = async () => {
    // iOS はここで OS の確認ボタンを出す。読めなければ何もしない
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) editor.insertText(text);
  };

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      // 押しても焦点を奪わない。奪うとキーボードが閉じて選択も消える
      onPointerDown={(event) => event.preventDefault()}
    >
      {/*
        押したことにするのは pointerup。焦点を残すために pointerdown を止めると、
        WebKit では合成マウスイベントごと消えて click が来ない
      */}
      <button type="button" onPointerUp={cut}>
        カット
      </button>
      <button type="button" onPointerUp={copy}>
        コピー
      </button>
      <button type="button" onPointerUp={paste} disabled={!canRead()}>
        ペースト
      </button>
      <button type="button" onPointerUp={() => editor.selectAll()}>
        全選択
      </button>
    </div>
  );
}

/**
 * クリップボードを読めるか。
 * navigator.clipboard は https か localhost でしか生えないので、
 * LAN の IP で実機から開いているときは undefined になる
 */
function canRead(): boolean {
  return typeof navigator.clipboard?.readText === "function";
}

/** 書くほうは、読めない環境でも execCommand に落とせば通ることがある */
async function writeClipboard(text: string): Promise<void> {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 落ちたら下へ
    }
  }
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  Object.assign(scratch.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
  document.body.appendChild(scratch);
  scratch.select();
  scratch.setSelectionRange(0, text.length);
  document.execCommand("copy");
  scratch.remove();
}

/**
 * いま本当に見えている範囲。floating-ui が既定で見るのは layout viewport で、
 * iOS はキーボードでそこを縮めてくれないので、キーボードの裏に置かれてしまう
 */
function visibleArea(): { x: number; y: number; width: number; height: number } {
  const viewport = window.visualViewport;
  if (!viewport) return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  return {
    x: viewport.offsetLeft,
    y: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
  };
}
