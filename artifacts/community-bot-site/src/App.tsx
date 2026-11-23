import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  Copy,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';

type Category = 'Staff' | 'Security' | 'Community' | 'Settings';
type Command = { name: string; description: string; category: Category };

const commands: Command[] = [
  { name: 'fban @member [reason]', description: 'Ban a member or user ID.', category: 'Staff' },
  { name: 'fkick @member [reason]', description: 'Remove a member from the server.', category: 'Staff' },
  { name: 'ftimeout @member <duration> [reason]', description: 'Timeout for 15m, 2h, or up to 28 days.', category: 'Staff' },
  { name: 'funtimeout @member [reason]', description: 'Remove an active timeout.', category: 'Staff' },
  { name: 'fwarn @member <reason>', description: 'Save a persistent staff warning.', category: 'Staff' },
  { name: 'fwarnings @member', description: 'Review the latest saved warnings.', category: 'Staff' },
  { name: 'fclear <1-100>', description: 'Delete recent messages (Discord limits bulk delete to messages under 14 days).', category: 'Staff' },
  { name: 'fslowmode <0-21600>', description: 'Set a channel slowmode in seconds; 0 turns it off.', category: 'Staff' },
  { name: 'flock / funlock', description: 'Lock this channel for @everyone and restore its previous setting.', category: 'Staff' },
  { name: 'fsecurity status', description: 'See the current raid and spam protection settings.', category: 'Security' },
  { name: 'fsecurity raid on|off', description: 'Enable or disable rapid-join alerts.', category: 'Security' },
  { name: 'fsecurity threshold <joins> <seconds>', description: 'Choose when a burst of new joins triggers an alert.', category: 'Security' },
  { name: 'fsecurity spam on|off', description: 'Enable or disable message-rate and repeat detection.', category: 'Security' },
  { name: 'fsecurity spamlimit <messages> <seconds>', description: 'Set the message-rate threshold for spam detection.', category: 'Security' },
  { name: 'fsecurity repeats <count>', description: 'Set how many repeated messages trigger spam detection.', category: 'Security' },
  { name: 'fsecurity autotimeout on|off', description: 'Apply a one-minute timeout after repeated spam violations.', category: 'Security' },
  { name: 'fsecurity autoverify on|off', description: 'Temporarily raise verification to High after a join alert. Requires Manage Server.', category: 'Security' },
  { name: 'f8ball <question>', description: 'Get a lighthearted answer.', category: 'Community' },
  { name: 'fcoinflip', description: 'Flip a coin for fun. No wagers or points.', category: 'Community' },
  { name: 'ftrivia', description: 'Start a 30-second trivia round; first correct answer earns 15 points.', category: 'Community' },
  { name: 'frps <rock|paper|scissors>', description: 'Play rock-paper-scissors.', category: 'Community' },
  { name: 'fcompliment [@member]', description: 'Send a friendly compliment.', category: 'Community' },
  { name: 'fjoke', description: 'Get a clean joke for the channel.', category: 'Community' },
  { name: 'frandom [min] [max]', description: 'Generate a random whole number.', category: 'Community' },
  { name: 'fprofile [@member]', description: 'View a server profile and point balance.', category: 'Community' },
  { name: 'fdaily', description: 'Claim 25 points once every 24 hours.', category: 'Community' },
  { name: 'fleaderboard', description: 'Show the top 10 point balances in this server.', category: 'Community' },
  { name: 'fprefix <prefix>', description: 'Set this server’s command prefix (1–5 characters).', category: 'Settings' },
  { name: 'flog #channel / flog off', description: 'Choose where moderation and security logs go.', category: 'Settings' },
  { name: 'fwelcome #channel [message]', description: 'Configure welcome messages, or use fwelcome off.', category: 'Settings' },
  { name: 'fgoodbye #channel [message]', description: 'Configure goodbye messages, or use fgoodbye off.', category: 'Settings' },
  { name: 'fresponse welcome|goodbye|spam|spamtimeout <message>', description: 'Customize welcome, goodbye, and spam-filter responses.', category: 'Settings' },
  { name: 'fannounce #channel <message>', description: 'Send a staff announcement without mass mentions.', category: 'Settings' },
  { name: 'fsettings', description: 'Review this server’s current bot settings.', category: 'Settings' },
  { name: 'fhelp', description: 'Show command help in your server.', category: 'Settings' },
];

const categories = ['All', 'Staff', 'Security', 'Community', 'Settings'] as const;
const inviteClientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
const inviteUrl = inviteClientId
  ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(inviteClientId)}&scope=bot&permissions=1099511721082`
  : null;

function InviteLink({ className, children }: { className: string; children: ReactNode }) {
  return inviteUrl ? (
    <a className={className} href={inviteUrl} target="_blank" rel="noopener noreferrer" data-testid="link-invite-discord">
      {children}
    </a>
  ) : (
    <a className={className} href="#setup" data-testid="link-invite-setup">
      {children}
    </a>
  );
}

const faqItems = [
  {
    question: 'What permissions does F need?',
    answer: 'Only grant the permissions for features you plan to use. It needs View Channels, Send Messages, Read Message History, and Embed Links for core use. Moderation, channel controls, and temporary verification need their matching permissions; keep F’s role above the roles it moderates.',
  },
  {
    question: 'Does F use slash commands?',
    answer: 'F uses prefix commands. The default is f, so commands look like fhelp or fban. You can set a server-specific prefix with fprefix <new-prefix>; slash-command registration and a client ID are not required by the bot itself.',
  },
  {
    question: 'How does raid and spam protection behave?',
    answer: 'Rapid-join alerts default to 8 joins in 10 seconds. Spam detection defaults to more than 5 messages in 8 seconds or 3 repeated messages. Staff can tune each threshold, choose whether repeated spam triggers a one-minute timeout, and optionally enable temporary high verification after a raid alert.',
  },
  {
    question: 'Can points be bought, traded, or wagered?',
    answer: 'No. Points are for participation in your server. Members earn 2 points at most once per minute of normal chat, can claim 25 with fdaily, and can earn 15 for the first correct answer in trivia. Points cannot be wagered, transferred, or redeemed for money. Coinflip is just a coinflip: it has no wagers or points.',
  },
  {
    question: 'Does F answer general chat with AI?',
    answer: 'Yes. Mention F with your question to get an AI reply. Only messages addressed to F and your recent AI conversation are sent to OpenAI—not unrelated channel history. Memory expires after 10 minutes of inactivity or a restart. Use fchat reset to clear your context. Staff can use fchat on/off and fpersonality to configure it. AI usage draws from the bot owner’s Replit credits; answers can be wrong, so do not share private information.',
  },
];

function App() {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>('All');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return commands.filter((command) => {
      const categoryMatch = activeCategory === 'All' || command.category === activeCategory;
      const queryMatch = !normalized || `${command.name} ${command.description}`.toLowerCase().includes(normalized);
      return categoryMatch && queryMatch;
    });
  }, [activeCategory, query]);

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      window.setTimeout(() => setCopied((current) => current === command ? '' : current), 1800);
    } catch {
      setCopied('copy-error');
      window.setTimeout(() => setCopied(''), 2200);
    }
  }

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap nav-inner">
          <a className="brand" href="#top" aria-label="F community bot home" onClick={closeMobileNav}>
            <span className="brand-mark" aria-hidden="true">f</span>
            <span>F<span style={{ color: '#e17458' }}>.</span></span>
          </a>
          <nav className={`nav-links${mobileNavOpen ? ' nav-open' : ''}`} aria-label="Main navigation">
            <a href="#features" onClick={closeMobileNav}>What F does</a>
            <a href="#commands" onClick={closeMobileNav}>Commands</a>
            <a href="#setup" onClick={closeMobileNav}>Setup guide</a>
            <InviteLink className="button button-primary nav-cta">
              {inviteUrl ? 'Invite F' : 'How to get started'} <ArrowRight size={14} aria-hidden="true" />
            </InviteLink>
          </nav>
          <button
            className="mobile-menu"
            type="button"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
            data-testid="button-mobile-menu"
          >
            <span></span><span></span>
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div>
              <span className="eyebrow">A steadier server starts here</span>
              <h1>Keep your<br />community <em>good.</em></h1>
              <p className="hero-copy">F helps volunteer teams handle the hard moments and make room for the good ones — with practical moderation, thoughtful protection, and little ways to join in.</p>
              <div className="hero-actions">
                <InviteLink className="button button-primary">
                  {inviteUrl ? 'Invite F to your server' : 'See how to get started'} <ArrowRight size={16} aria-hidden="true" />
                </InviteLink>
                <a className="button button-quiet" href="#commands">Browse commands <ArrowDownRight size={15} aria-hidden="true" /></a>
              </div>
              <div className="trust-note"><span className="trust-dot" aria-hidden="true"></span>Prefix commands. Clear permissions. Your team stays in control.</div>
            </div>
            <div className="hero-art" aria-label="Illustration of F helping a Discord community">
              <div className="orbit" aria-hidden="true"></div>
              <div className="floating-tag tag-shield"><ShieldCheck size={14} aria-hidden="true" /><span>STAFF TOOLS READY</span></div>
              <div className="bot-card">
                <div className="discord-top"><span className="server-dot">F</span><span>the garden shed</span><span className="online" title="Online"></span></div>
                <div className="message">
                  <div className="message-avatar">f</div>
                  <div className="message-content">
                    <div className="message-name">F <span>BOT · 11:42 AM</span></div>
                    Quick round for anyone passing by?
                    <div><span className="command-chip">ftrivia</span></div>
                  </div>
                </div>
                <div className="response-box">A little friendly competition. First correct answer earns 15 points.</div>
                <div className="message">
                  <div className="message-avatar" style={{ background: '#e17458' }}>M</div>
                  <div className="message-content">
                    <div className="message-name">mossyday <span>11:42 AM</span></div>
                    Okay, that one I know.
                  </div>
                </div>
              </div>
              <div className="floating-tag tag-points"><span className="tag-dot" aria-hidden="true"></span><span>GOOD COMPANY, NOT GAMBLING</span></div>
            </div>
          </div>
        </section>

        <section className="section feature-section" id="features">
          <div className="wrap">
            <div className="section-heading">
              <span className="eyebrow">Useful, without the fuss</span>
              <h2>Back up the people<br />who hold it together.</h2>
              <p>F brings the everyday tools volunteer moderators reach for, plus a few lighter touches that help a server feel lived in.</p>
            </div>
            <div className="feature-grid">
              <article className="feature-card">
                <span className="feature-mark">01 / STAFF</span><span className="feature-icon"><LockKeyhole size={19} aria-hidden="true" /></span>
                <h3>Moderation with a paper trail</h3>
                <p>Ban, kick, timeout, warn, clear, and slow a channel down. Warnings persist, and staff can send moderation activity to a log channel.</p>
              </article>
              <article className="feature-card">
                <span className="feature-mark">02 / SAFETY</span><span className="feature-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
                <h3>A calmer first response</h3>
                <p>Spot rapid joins and message floods. Tune thresholds, configure spam handling, and optionally raise verification temporarily after a join alert.</p>
              </article>
              <article className="feature-card">
                <span className="feature-mark">03 / COMMUNITY</span><span className="feature-icon"><Sparkles size={19} aria-hidden="true" /></span>
                <h3>Small reasons to join in</h3>
                <p>Trivia, rock-paper-scissors, clean jokes, compliments, and a lighthearted eight ball give conversation an easy next step.</p>
                <span className="inline-note">Coinflip is just for fun — no wager, no points</span>
              </article>
              <article className="feature-card">
                <span className="feature-mark">04 / BELONGING</span><span className="feature-icon"><UsersRound size={20} aria-hidden="true" /></span>
                <h3>Points that stay in the server</h3>
                <p>Members earn modest points from regular chat and daily claims. Profiles and a leaderboard make participation visible, never cash-like.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section command-section" id="commands">
          <div className="wrap command-layout">
            <div className="command-aside">
              <span className="eyebrow">A command away</span>
              <h2>Clear words.<br />Useful work.</h2>
              <p>F uses short prefix commands your team can learn at a glance. Filter the reference or search for a task, then copy a command to try it in Discord.</p>
              <div className="prefix-note"><span>Default prefix</span><code>f</code><span>Change it any time with fprefix</span></div>
            </div>
            <div className="command-panel">
              <div className="command-toolbar">
                <div className="filter-tabs" role="group" aria-label="Filter commands by category">
                  {categories.map((category) => (
                    <button
                      className="filter-tab"
                      key={category}
                      type="button"
                      aria-pressed={activeCategory === category}
                      onClick={() => setActiveCategory(category)}
                      data-testid={`button-filter-${category.toLowerCase()}`}
                    >{category}</button>
                  ))}
                </div>
                <label className="command-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Find a command"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search commands"
                    data-testid="input-command-search"
                  />
                </label>
              </div>
              <div className="command-list" aria-live="polite">
                {visibleCommands.length ? visibleCommands.map((command) => (
                  <div className="command-row" key={command.name}>
                    <div><code className="command-name">{command.name}</code><span className="command-desc">{command.description}</span></div>
                    <button
                      type="button"
                      className="copy-button"
                      onClick={() => void copyCommand(command.name)}
                      aria-label={`${copied === command.name ? 'Copied' : 'Copy'} ${command.name}`}
                      data-testid={`button-copy-${command.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
                    >
                      {copied === command.name ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copied === command.name ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )) : <div className="no-results">No commands match that search. Try another word or category.</div>}
              </div>
            </div>
          </div>
        </section>

        <section className="section points-section" id="points">
          <div className="wrap points-inner">
            <div>
              <span className="eyebrow">Participation, not pressure</span>
              <h2>Points for showing up.</h2>
              <p>F’s points are a little record of community participation. They stay on your server: no transfers, no redemption, and no wagering. The coinflip command is separate and purely for fun.</p>
            </div>
            <div className="point-rules" aria-label="How community points work">
              <div className="rule-row"><span>Normal chat activity</span><strong>+2 / minute max</strong></div>
              <div className="rule-row"><span>Daily claim</span><strong>+25 / 24 hours</strong></div>
              <div className="rule-row"><span>First correct trivia answer</span><strong>+15 points</strong></div>
              <div className="rule-row"><span>Coinflip</span><strong>No points / wagers</strong></div>
            </div>
          </div>
        </section>

        <section className="section setup-section" id="setup">
          <div className="wrap">
            <div className="section-heading">
              <span className="eyebrow">A good start is a safe one</span>
              <h2>Set F up with care.</h2>
              <p>Invite F, choose only the permissions you need, then let your team decide how it should behave.</p>
            </div>
            <div className="setup-grid">
              <article className="setup-step">
                <span className="step-number">01</span><h3>Create your bot application</h3>
                <p>In the Discord Developer Portal, create an application and add a bot user. Enable <strong>Message Content Intent</strong> and <strong>Server Members Intent</strong> under Privileged Gateway Intents.</p>
              </article>
              <article className="setup-step">
                <span className="step-number">02</span><h3>Invite with the right access</h3>
                <p>Use the invite action above when configured, or create the OAuth2 invite in the Developer Portal with the <code>bot</code> scope. Choose only permissions for the features you plan to use.</p>
                <div className="permission-list"><span>Manage Messages</span><span>Moderate Members</span><span>Manage Channels</span><span>Manage Server, if needed</span></div>
              </article>
              <article className="setup-step">
                <span className="step-number">03</span><h3>Run it, then make it yours</h3>
                <p>Keep the bot token in Replit Secrets as <code>DISCORD_TOKEN</code>. Start the bot, put its role above the roles it moderates, then use <code>fsettings</code> and <code>fsecurity status</code>.</p>
              </article>
            </div>
            <div className="setup-callout">
              <p><strong>Protect the token.</strong> Never paste it into chat, source code, or screenshots. F uses prefix commands; the bot itself does not require a client ID or slash-command registration.</p>
              <a className="button button-quiet" href="#commands">Explore the commands <ArrowRight size={14} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="wrap faq-grid">
            <div className="section-heading">
              <span className="eyebrow">Before you invite</span>
              <h2>The important bits, plainly.</h2>
              <p>Good community tools should be clear about what they can do — and what they won’t.</p>
            </div>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <article className="faq-item" key={item.question}>
                  <button
                    className="faq-question"
                    type="button"
                    aria-expanded={openFaq === index}
                    aria-controls={`faq-answer-${index}`}
                    onClick={() => setOpenFaq((open) => open === index ? null : index)}
                    data-testid={`button-faq-${index + 1}`}
                  >
                    {item.question}<Plus size={17} aria-hidden="true" />
                  </button>
                  {openFaq === index && <div className="faq-answer" id={`faq-answer-${index}`}>{item.answer}</div>}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="wrap final-cta-inner">
            <div><h2>A little more room to be a community.</h2><p>Give your volunteer team a hand and your members a reason to join in.</p></div>
            <InviteLink className="button button-primary">
              {inviteUrl ? 'Invite F to Discord' : 'Start with the setup guide'} <ArrowRight size={16} aria-hidden="true" />
            </InviteLink>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-inner">
          <a className="brand" href="#top" aria-label="F community bot home"><span className="brand-mark">f</span><span>F<span style={{ color: '#e17458' }}>.</span></span></a>
          <span className="footer-copy">Made for the people who keep a good server going.</span>
          <nav className="footer-links" aria-label="Footer navigation">
            <a href="#features">Features</a><a href="#commands">Commands</a><a href="#setup">Setup</a><a href="#faq">FAQ</a>
          </nav>
        </div>
      </footer>
      {copied === 'copy-error' && <div className="toast" role="status">Couldn’t copy automatically. Select the command text and copy it.</div>}
      {copied && copied !== 'copy-error' && <div className="toast" role="status"><Check size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} aria-hidden="true" />Command copied to clipboard.</div>}
    </div>
  );
}

export default App;
