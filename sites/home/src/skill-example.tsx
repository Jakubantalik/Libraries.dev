import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { BotAvatar } from "bot-avatars";
import { ImageGeneration, type ImageGenerationHandle } from "img-fx";
import { ChatInputMock } from "./examples/beam-mocks";

/* One chat turn on a loop: the user asks for an image, the assistant works
   on it, then answers with the result. `?style=generic` renders what an
   agent writes without the skill (a spinner, a grey box, a letter avatar);
   the default renders what the Libraries.dev skill suggests for the same
   spots. Both panes run the same clock so they stay comparable. */

const GENERIC = new URLSearchParams(location.search).get("style") === "generic";
const THINK_MS = 3400;
const ANSWER_MS = 4200;
const IMAGES = ["/images/gen-1.jpg", "/images/gen-2.jpg", "/images/gen-3.jpg"];

function usePhase(): [boolean, number] {
  const [turn, setTurn] = useState(0);
  const [thinking, setThinking] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (thinking) setThinking(false);
      else { setThinking(true); setTurn((n) => n + 1); }
    }, thinking ? THINK_MS : ANSWER_MS);
    return () => window.clearTimeout(t);
  }, [thinking]);
  return [thinking, turn];
}

function Generic() {
  const [thinking, turn] = usePhase();
  return (
    <div className="sx-card">
      <div className="sx-thread">
        <div className="sx-user">Make a cover image for our launch post</div>
        <div className="sx-bot">
          <div className="sx-avatar-plain" aria-hidden="true">AI</div>
          <div className="sx-body">
            <div className="sx-line">
              {thinking ? <><span className="sx-spinner" aria-hidden="true" />Loading...</> : "Here's a cover for the launch post."}
            </div>
            <div className="sx-image sx-image-plain">
              {thinking ? "Generating image..." : <img src={IMAGES[turn % IMAGES.length]} alt="" />}
            </div>
          </div>
        </div>
      </div>
      <div className="sx-input"><ChatInputMock /></div>
    </div>
  );
}

function WithSkill() {
  const [thinking, turn] = usePhase();
  const image = useRef<ImageGenerationHandle>(null);
  // The generation shader runs while the assistant works; the finished
  // image dissolves in with the answer and goes back to the shader next turn.
  useEffect(() => {
    if (thinking) image.current?.triggerHide();
    else image.current?.triggerReveal({ hold: "manual" });
  }, [thinking, turn]);
  return (
    <div className="sx-card">
      <div className="sx-thread">
        <div className="sx-user">Make a cover image for our launch post</div>
        <div className="sx-bot">
          <BotAvatar type="clover" state={thinking ? "working" : "default"} size={32} />
          <div className="sx-body">
            <div className="sx-line">
              {thinking ? (
                <>
                  <ThinkingOrb state="composing" size={20} theme="dark" aria-label="Generating" />
                  <span className="t-shimmer" data-text="Generating image…">Generating image…</span>
                </>
              ) : (
                "Here's a cover for the launch post."
              )}
            </div>
            <ImageGeneration ref={image} preset="pixels-organic" theme="dark" images={IMAGES}>
              <div className="sx-image" />
            </ImageGeneration>
          </div>
        </div>
      </div>
      <div className="sx-input">
        <BorderBeam size="md" colorVariant="colorful" theme="dark" active={thinking}>
          <ChatInputMock />
        </BorderBeam>
      </div>
    </div>
  );
}

const el = document.getElementById("skill-example-root");
if (el) {
  createRoot(el).render(<StrictMode>{GENERIC ? <Generic /> : <WithSkill />}</StrictMode>);
}
