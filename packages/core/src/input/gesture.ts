import type { Handle } from "../layout";

/**
 * 指とマウスの判定。**DOM を知らない純粋な状態機械。**
 *
 * 出来事を受けて、新しい状態と「やること」を返す。実際にクリックした場所が何文字目かを
 * 引くのも、focus を入れるのも、呼び手 (pointer.ts) の仕事。
 * 閾値の判定はここに閉じているので、node のテストで縛れる。
 */

/** 選択を伸ばす粒度。ダブルクリックのあとは語ごと、トリプルなら段落ごと */
export type Granularity = "char" | "word" | "paragraph";

/** これだけ動いたら、タップしたのではなくスクロール (CSS px) */
const TAP_SLOP = 8;

/** 置いたままこれだけ待たれたら長押し。iOS の作法に合わせる (ms) */
export const LONG_PRESS = 500;

/**
 * 続けて叩いた / 押したと見なす間隔 (ms) と、その間に許すずれ (CSS px)。
 * **マウスの回数も自分で数える**——`PointerEvent.detail` は仕様で常に 0 なので、
 * ブラウザに聞くと 2 回目が永久に来ない
 */
const DOUBLE_TAP = 300;
const DOUBLE_TAP_SLOP = 24;

/** 指やマウスの出来事。DOM の型は持たない */
export type PointerInput =
  | {
      type: "down";
      id: number;
      x: number;
      y: number;
      /** 出来事の時刻 (ms) */
      at: number;
      touch: boolean;
      shift: boolean;
      /** タップした場所にハンドルがあるか。押す前にレイアウトへ聞いておく */
      handle: Handle | null;
    }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "up"; id: number; x: number; y: number; shift: boolean }
  | { type: "cancel"; id: number }
  /** 長押しの時間が来た */
  | { type: "longPress"; id: number; x: number; y: number };

export interface GestureState {
  /** 指を置いた場所。離すまでは、タップしたのかスクロールなのか決まらない */
  readonly tap: { id: number; x: number; y: number } | null;
  /** ドラッグしている最中。extend なら伸ばす、でなければキャレットを動かす */
  readonly drag: { extend: boolean; by: Granularity } | null;
  /** 直前にタップした場所と時刻 */
  readonly lastTap: { at: number; x: number; y: number } | null;
  /** 続けてタップされた回数 */
  readonly taps: number;
}

export const newGestureState: GestureState = { tap: null, drag: null, lastTap: null, taps: 0 };

/** 決まったこと。順番どおりに実行する */
export type GestureEffect =
  | { type: "forgetAnchor" }
  | { type: "placeCaret"; x: number; y: number; extend: boolean; by: Granularity }
  | { type: "selectWord"; x: number; y: number }
  | { type: "selectParagraph"; x: number; y: number }
  | { type: "grabHandle"; handle: Handle }
  | { type: "showHandles"; show: boolean }
  | { type: "focus" }
  | { type: "capture"; id: number }
  | { type: "release"; id: number }
  | { type: "waitLongPress"; id: number; x: number; y: number }
  | { type: "cancelLongPress" };

export interface GestureResult {
  readonly state: GestureState;
  readonly effects: readonly GestureEffect[];
}

export function onPointer(state: GestureState, input: PointerInput): GestureResult {
  switch (input.type) {
    case "down":
      return input.touch ? touchDown(state, input) : mouseDown(state, input);
    case "move":
      return move(state, input);
    case "up":
      return up(state, input);
    case "cancel": {
      const stopped = stop(forgetTap(state), input.id);
      return { state: stopped.state, effects: [{ type: "cancelLongPress" }, ...stopped.effects] };
    }
    case "longPress":
      return longPress(state, input);
  }
}

/** focus を失ったらドラッグも終わり。掴んだ指は離れている */
export function cancelDrag(state: GestureState): GestureState {
  if (!state.drag) return state;
  return { ...state, drag: null };
}

function mouseDown(
  state: GestureState,
  input: Extract<PointerInput, { type: "down" }>,
): GestureResult {
  const { x, y } = input;
  // 触り直した。指でパンするならもう戻す先ではないし、タップするなら下で置き直す。
  // マウスで触り直したら、指のためのハンドルは引っ込める
  const effects: GestureEffect[] = [{ type: "forgetAnchor" }, { type: "showHandles", show: false }];

  // 回数は自分で数える。押した時点で選び、そのまま語・段落ごとにドラッグできる
  const clicks = state.lastTap && isNearInTime(input, state.lastTap) ? state.taps + 1 : 1;
  const lastTap = { at: input.at, x, y };
  const by: Granularity = clicks >= 3 ? "paragraph" : clicks === 2 ? "word" : "char";

  if (by === "paragraph") effects.push({ type: "selectParagraph", x, y });
  else if (by === "word") effects.push({ type: "selectWord", x, y });

  // 測る → 置く → focus、の順。focus を先に入れると、その時点の
  // 古いキャレットを見せるためにスクロールが動き、クリックした場所が画面ごとずれる
  effects.push({ type: "capture", id: input.id });
  if (by === "char") effects.push({ type: "placeCaret", x, y, extend: input.shift, by });
  effects.push({ type: "focus" });

  return { state: { tap: null, lastTap, taps: clicks, drag: { extend: true, by } }, effects };
}

/**
 * 指の割り当ては iOS の編集可能なテキストに合わせる。
 *
 * - タップ … キャレットを置く
 * - 続けて 2 回 … 単語、3 回 … 段落。掴んだままドラッグすれば伸びる
 * - 長押し … そのままキャレットを引き回す
 * - スワイプ … スクロール (ブラウザに任せる)
 */
function touchDown(
  state: GestureState,
  input: Extract<PointerInput, { type: "down" }>,
): GestureResult {
  const { x, y, id } = input;
  const effects: GestureEffect[] = [{ type: "forgetAnchor" }];

  // ハンドルは押した時点で掴む。掴みに来た指をタップした扱いにしても意味がない。
  // ハンドルが出るのは選択があるときだけなので、タップ・スワイプとは競合しない
  if (input.handle) {
    effects.push(
      { type: "cancelLongPress" },
      { type: "grabHandle", handle: input.handle },
      { type: "capture", id },
    );
    return { state: { ...forgetTap(state), drag: { extend: true, by: "char" } }, effects };
  }

  const taps = state.lastTap && isNearInTime(input, state.lastTap) ? state.taps + 1 : 1;
  const lastTap = { at: input.at, x, y };

  if (taps >= 2) {
    // 合成マウスイベントは止めてあるので、ダブルクリックの回数は当てにできない。
    // 2 回目を押した時点で選び、そのままドラッグできるようにする
    effects.push(
      taps >= 3 ? { type: "selectParagraph", x, y } : { type: "selectWord", x, y },
      { type: "showHandles", show: true },
      { type: "focus" },
      { type: "capture", id },
    );
    return {
      state: {
        tap: null,
        lastTap,
        taps,
        drag: { extend: true, by: taps >= 3 ? "paragraph" : "word" },
      },
      effects,
    };
  }

  // ここで focus を入れると、スワイプしただけでキーボードが出てくる。離すまで待つ
  effects.push({ type: "cancelLongPress" }, { type: "waitLongPress", id, x, y });
  return { state: { ...state, tap: { id, x, y }, lastTap, taps }, effects };
}

function move(state: GestureState, input: Extract<PointerInput, { type: "move" }>): GestureResult {
  if (state.tap?.id === input.id) {
    // 指が動いたならスクロール。タップした扱いも長押しもやめる
    if (!movedFromTap(input, state.tap)) return { state, effects: [] };
    return { state: forgetTap(state), effects: [{ type: "cancelLongPress" }] };
  }
  if (!state.drag) return { state, effects: [] };
  // 掴んだ側は置いたまま伸ばす。長押しからのときは、キャレットごと動かす
  return {
    state,
    effects: [
      { type: "placeCaret", x: input.x, y: input.y, extend: state.drag.extend, by: state.drag.by },
    ],
  };
}

function up(state: GestureState, input: Extract<PointerInput, { type: "up" }>): GestureResult {
  const effects: GestureEffect[] = [{ type: "cancelLongPress" }];
  const tap = state.tap;

  if (tap?.id === input.id && !movedFromTap(input, tap)) {
    // 置いた場所から動かずに離した = タップした。ここで初めて focus を入れる。
    // focus より先に置く。あとで入れると、古いキャレットを見せるスクロールに持っていかれる
    effects.push(
      { type: "placeCaret", x: input.x, y: input.y, extend: input.shift, by: "char" },
      { type: "showHandles", show: true },
      { type: "focus" },
    );
  }
  const stopped = stop({ ...state, tap: null }, input.id);
  return { state: stopped.state, effects: [...effects, ...stopped.effects] };
}

/**
 * 指を置いたまま待たれたら、そのままキャレットを引き回す。
 * 指のドラッグはスクロールに使っているので、置き直したいという意思はここでしか拾えない
 */
function longPress(
  state: GestureState,
  input: Extract<PointerInput, { type: "longPress" }>,
): GestureResult {
  if (state.tap?.id !== input.id) return { state, effects: [] };
  // 掴んだ扱いにする。離しても置き直しはしない
  return {
    state: { tap: null, lastTap: null, taps: 0, drag: { extend: false, by: "char" } },
    effects: [
      { type: "placeCaret", x: input.x, y: input.y, extend: false, by: "char" },
      { type: "showHandles", show: true },
      { type: "focus" },
      { type: "capture", id: input.id },
    ],
  };
}

function stop(state: GestureState, id: number): GestureResult {
  if (!state.drag) return { state, effects: [] };
  return { state: { ...state, drag: null }, effects: [{ type: "release", id }] };
}

/** タップした扱いをやめる。続けてタップした数も切る */
function forgetTap(state: GestureState): GestureState {
  return { ...state, tap: null, lastTap: null, taps: 0 };
}

/** 続けてタップしたと言えるか。間隔と、指のずれの両方で見る */
function isNearInTime(
  input: { at: number; x: number; y: number },
  previous: { at: number; x: number; y: number },
): boolean {
  return (
    input.at - previous.at < DOUBLE_TAP &&
    Math.abs(input.x - previous.x) <= DOUBLE_TAP_SLOP &&
    Math.abs(input.y - previous.y) <= DOUBLE_TAP_SLOP
  );
}

/** 指がスクロールと言えるだけ動いたか */
function movedFromTap(input: { x: number; y: number }, tap: { x: number; y: number }): boolean {
  return Math.abs(input.x - tap.x) > TAP_SLOP || Math.abs(input.y - tap.y) > TAP_SLOP;
}
