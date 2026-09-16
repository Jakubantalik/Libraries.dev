/* The Beam demo page's mock UI, verbatim from sites/beam/src/mocks.tsx so
   the detail page shows exactly what that page shows. Presentational and
   class-driven; the styling lives in assets/examples.css. */

export function AtSignIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10.4 5.59963V8.59962C10.4 9.07701 10.5896 9.53485 10.9272 9.87242C11.2648 10.21 11.7226 10.3996 12.2 10.3996C12.6774 10.3996 13.1352 10.21 13.4728 9.87242C13.8104 9.53485 14 9.07701 14 8.59962V7.99962C13.9999 6.64544 13.5417 5.33111 12.7 4.27035C11.8582 3.20958 10.6823 2.46476 9.36359 2.15701C8.04484 1.84925 6.66076 1.99665 5.43641 2.57525C4.21206 3.15384 3.21944 4.1296 2.61996 5.34386C2.02048 6.55812 1.84939 7.93947 2.13451 9.26329C2.41963 10.5871 3.14419 11.7756 4.19038 12.6354C5.23657 13.4952 6.54286 13.9758 7.89684 13.9991C9.25083 14.0224 10.5729 13.587 11.648 12.7636M10.4 7.99962C10.4 9.32511 9.32549 10.3996 8 10.3996C6.67452 10.3996 5.6 9.32511 5.6 7.99962C5.6 6.67414 6.67452 5.59963 8 5.59963C9.32549 5.59963 10.4 6.67414 10.4 7.99962Z"
        stroke="#808388"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ transform: 'rotate(90deg)' }}>
      <path d="M7 11L10 8L7 5" stroke="#8B9099" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 12.6667V3.33333M12.6667 8L8 3.33333L3.33333 8" stroke="#8B8B8B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TaskCircleIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 17.5 17.5" fill="none">
      <circle cx="8.75" cy="8.75" r="8" stroke="#818181" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function MockChatInput() {
  return (
    <div className="mock-chat" role="img" aria-label="Chat input UI example with border beam effect">
      <div className="mock-chat-inner">
        <div className="pill">
          <AtSignIcon />
        </div>
        <div className="placeholder">Build anything...</div>
        <div className="bottom-row">
          <div className="tag">
            Agent
            <ChevronDownIcon />
          </div>
          <div className="tag">
            Auto
            <ChevronDownIcon />
          </div>
          <div className="send-btn">
            <ArrowUpIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

export const WORKING_TASKS = [
  'Generate color palettes',
  'Recommend font pairings',
  'Create layout templates',
  'Build section engine',
  'Generate hero variants',
];

export function MockWorkingCard() {
  return (
    <div className="mock-working" role="img" aria-label="Agent task list UI example with border beam effect">
      <div className="mock-working-header t-shimmer" data-text="Working...">Working...</div>
      <div className="mock-working-list">
        {WORKING_TASKS.map((task) => (
          <div className="mock-working-row" key={task}>
            <TaskCircleIcon />
            <span>{task}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MockSubscribeButton() {
  return (
    <div className="mock-subscribe" role="img" aria-label="Subscribe button UI example with border beam effect">
      Subscribe
    </div>
  );
}

export function MockIconButton() {
  return (
    <div className="mock-icon-btn" role="img" aria-label="Icon button UI example with border beam effect">
      <div className="mock-icon-btn-square" />
    </div>
  );
}

export function MockSearchBar() {
  return (
    <div className="mock-search" role="img" aria-label="Search bar UI example with border beam effect">
      <div className="mock-search-inner">
        <SearchIcon />
        <span>Search</span>
      </div>
    </div>
  );
}

/* Studio chat input (Figma 1561:44249 dark, 1567:44998 light), shared by
   the Voice and Border beam benches: the prompt,
   an add button on the left and the Agent chip, mic and close on the
   right. Icons are masked spans so each theme sets their colour; the
   plus and close glyphs are CSS bars (the Figma export collapsed them). */
export function ChatInputMock({ radius = 20 }: { radius?: number }) {
  return (
    <form className="mock-vchat" aria-label="Chat input UI example" style={radius !== 20 ? { borderRadius: radius } : undefined} onSubmit={(e) => e.preventDefault()}>
      {/* A real field and real buttons, so the mock can be typed into and
          pressed while the beam runs; nothing is sent anywhere. */}
      <input className="mock-vchat-input" type="text" placeholder="Ask me anything.." aria-label="Message" autoComplete="off" spellCheck={false} />
      <div className="mock-vchat-row">
        <button type="button" className="mock-vchat-btn" aria-label="Add">
          <span className="vb-ico vb-ico-plus" />
        </button>
        <div className="mock-vchat-actions">
          <button type="button" className="mock-vchat-btn mock-vchat-agent">
            Agent
            <span className="vb-ico vb-ico-chevron" />
          </button>
          <button type="button" className="mock-vchat-btn" aria-label="Voice">
            <span className="vb-ico vb-ico-mic" />
          </button>
          <button type="button" className="mock-vchat-btn mock-vchat-close" aria-label="Close">
            <span className="vb-ico vb-ico-plus vb-ico-x" />
          </button>
        </div>
      </div>
    </form>
  );
}
