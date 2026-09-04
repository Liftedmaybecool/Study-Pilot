const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('[data-view]');
const pageLabel = document.querySelector('#page-label');
const toast = document.querySelector('#toast');
const labels = { dashboard: 'Overview', tutor: 'AI Tutor', plan: 'Study plan', subjects: 'Subjects', materials: 'Materials', flashcards: 'Flashcards' };
const onboarding = document.querySelector('#onboarding');
const setupForm = document.querySelector('#setup-form');
const setupSteps = document.querySelectorAll('.setup-step');
let subjects = JSON.parse(localStorage.getItem('studypilot-subjects') || '[]');
let setupStep = 1;
const authScreen = document.querySelector('#auth-screen');
const authPanels = document.querySelectorAll('.auth-panel');
const providerBenefit = document.querySelector('#provider-benefit');
let pendingCode = '';
let pendingEmail = '';
let authMode = 'signup';
const providerBenefits = {
  google: 'Use your Google identity for a quick sign-in. Calendar study scheduling can be added later with your permission.',
  github: 'Use your GitHub identity for a quick sign-in. Programming learners can later connect selected repositories for context.',
  discord: 'Use your Discord identity and, with separate consent, join approved study servers and share study presence. Private friend activity is never read by default.',
  notion: 'Connect an approved Notion workspace to capture notes while you study. StudyPilot can help organize, summarize, and turn your notes into review prompts.'
};

function showProviderBenefit(provider) {
  if (providerBenefit) providerBenefit.innerHTML = `<strong>Why connect?</strong><span>${providerBenefits[provider]}</span>`;
}

function showAuthPanel(mode) {
  authMode = mode;
  authPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.authPanel === mode));
}

function createCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function completeAuth(name) {
  localStorage.setItem('studypilot-auth-complete', 'true');
  if (name) localStorage.setItem('studypilot-name', name);
  authScreen.classList.add('hidden');
  if (localStorage.getItem('studypilot-setup-complete') !== 'true') {
    onboarding.classList.remove('hidden');
    setSetupStep(1);
  }
}

function startOAuth(provider) {
  window.location.assign(`/auth/${provider}`);
}

function showDemoCode(elementId, code, message) {
  const element = document.querySelector(`#${elementId}`);
  if (element) element.textContent = `Demo mode: ${message} Your code is ${code}.`;
}

if (localStorage.getItem('studypilot-auth-complete') === 'true') authScreen.classList.add('hidden');

function showView(name) {
  const target = document.querySelector(`#${name}-view`);
  if (!target) return;
  views.forEach(view => view.classList.remove('active-view'));
  target.classList.add('active-view');
  navItems.forEach(item => item.classList.toggle('active', item.dataset.view === name));
  pageLabel.textContent = labels[name] || 'Overview';
  window.location.hash = name;
  document.querySelector('.sidebar')?.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navItems.forEach(item => item.addEventListener('click', event => {
  event.preventDefault();
  showView(item.dataset.view);
}));

const initialView = window.location.hash.replace('#', '');
if (labels[initialView]) showView(initialView);

function setSetupStep(nextStep) {
  setupStep = nextStep;
  setupSteps.forEach(step => step.classList.toggle('active', Number(step.dataset.step) === nextStep));
  const progress = document.querySelector('#onboarding-progress-bar');
  const count = document.querySelector('#step-count');
  if (progress) progress.style.width = `${Math.min(nextStep, 3) * 33.333}%`;
  if (count) count.textContent = nextStep < 4 ? `Step ${nextStep} of 3` : nextStep === 4 ? 'Analyzing your scheme' : 'Ready to learn';
}

function renderSetupSubjects() {
  const list = document.querySelector('#setup-subjects');
  if (!list) return;
  list.innerHTML = subjects.length ? subjects.map((subject, index) => `<span class="subject-tag">${escapeHtml(subject)} <button type="button" data-remove-subject="${index}" aria-label="Remove ${escapeHtml(subject)}">×</button></span>`).join('') : '<span class="empty-subjects">Your subjects will appear here</span>';
}

function finishOnboarding() {
  const name = setupForm.elements.name.value.trim();
  localStorage.setItem('studypilot-name', name);
  localStorage.setItem('studypilot-class', setupForm.elements.className.value.trim());
  localStorage.setItem('studypilot-subjects', JSON.stringify(subjects));
  localStorage.setItem('studypilot-scheme', document.querySelector('#scheme-input').value.trim());
  if (name) {
    const greeting = document.querySelector('#dashboard-view h1');
    const profileName = document.querySelector('.profile-copy strong');
    if (greeting) greeting.innerHTML = `Good morning, ${escapeHtml(name)} <span class="wave">✦</span>`;
    if (profileName) profileName.textContent = name;
  }
  localStorage.setItem('studypilot-setup-complete', 'true');
  onboarding.classList.add('hidden');
  notify('Your workspace is ready. Your first focus is waiting.');
}

if (localStorage.getItem('studypilot-setup-complete') === 'true') onboarding.classList.add('hidden');

document.querySelector('.mobile-menu')?.addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(window.toastTimer);
  window.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

const oauthQuery = new URLSearchParams(window.location.search);
if (oauthQuery.get('oauth') === 'success') {
  const provider = oauthQuery.get('provider') || 'provider';
  localStorage.setItem('studypilot-auth-provider', provider);
  completeAuth(`${provider[0].toUpperCase() + provider.slice(1)} learner`);
  window.history.replaceState({}, document.title, window.location.pathname);
  notify(`Signed in with ${provider[0].toUpperCase() + provider.slice(1)}. Let’s personalize your workspace.`);
}
if (oauthQuery.get('auth_error')) {
  notify('OAuth sign-in could not be completed. Please try again.');
  window.history.replaceState({}, document.title, window.location.pathname);
}

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const prompt = event.target.closest('[data-prompt]')?.dataset.prompt;
  const removeIndex = event.target.closest('[data-remove-subject]')?.dataset.removeSubject;
  const authModeTarget = event.target.closest('[data-auth-mode]')?.dataset.authMode;
  const oauthProvider = event.target.closest('[data-oauth]')?.dataset.oauth;
  if (authModeTarget) showAuthPanel(authModeTarget);
  if (oauthProvider) startOAuth(oauthProvider);
  if (removeIndex !== undefined) {
    subjects.splice(Number(removeIndex), 1);
    renderSetupSubjects();
    return;
  }
  if (prompt) {
    showView('tutor');
    addUserMessage(prompt);
    window.setTimeout(() => addTutorMessage(responseFor(prompt)), 450);
  }
  if (action === 'start-session') notify('Session ready. Take it one question at a time.');
  if (action === 'add-focus') notify('Focus picker is ready for your next activity.');
  if (action === 'practice') notify('Practice set created for Punnett squares.');
  if (action === 'add-exam') notify('Exam setup opened.');
  if (action === 'add-subject') notify('Subject setup opened.');
  if (action === 'upload') notify('Choose a PDF, note, or slide deck to add.');
  if (action === 'start-review') notify('Your 24 due cards are queued.');
  if (action === 'new-class') {
    onboarding.classList.remove('hidden');
    const hasExistingSetup = localStorage.getItem('studypilot-setup-complete') === 'true';
    if (hasExistingSetup) {
      setupForm.elements.name.value = localStorage.getItem('studypilot-name') || '';
      setupForm.elements.className.value = localStorage.getItem('studypilot-class') || '';
      document.querySelector('#scheme-input').value = localStorage.getItem('studypilot-scheme') || '';
      subjects = JSON.parse(localStorage.getItem('studypilot-subjects') || '[]');
    } else {
      setupForm.reset();
      subjects = [];
    }
    renderSetupSubjects();
    setSetupStep(hasExistingSetup ? 2 : 1);
  }
});

document.addEventListener('mouseover', event => {
  const provider = event.target.closest('[data-oauth]')?.dataset.oauth;
  if (provider) showProviderBenefit(provider);
});

document.querySelector('#signup-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  pendingEmail = form.elements.email.value.trim();
  pendingCode = createCode();
  document.querySelector('#verify-email').textContent = pendingEmail;
  showDemoCode('demo-code', pendingCode, 'For this local prototype,');
  showAuthPanel('verify');
});

document.querySelector('#verify-form')?.addEventListener('submit', event => {
  event.preventDefault();
  if (document.querySelector('#verify-code').value.trim() !== pendingCode) {
    notify('That code does not match. Check the six digits and try again.');
    return;
  }
  localStorage.setItem('studypilot-user-email', pendingEmail);
  completeAuth(pendingEmail.split('@')[0]);
});

document.querySelector('#signin-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email.value.trim();
  localStorage.setItem('studypilot-user-email', email);
  completeAuth(localStorage.getItem('studypilot-name') || email.split('@')[0]);
});

document.querySelector('#forgot-form')?.addEventListener('submit', event => {
  event.preventDefault();
  pendingEmail = event.currentTarget.elements.email.value.trim();
  pendingCode = createCode();
  showDemoCode('reset-demo-code', pendingCode, 'For this local prototype,');
  showAuthPanel('reset');
});

document.querySelector('#reset-form')?.addEventListener('submit', event => {
  event.preventDefault();
  if (document.querySelector('#reset-code').value.trim() !== pendingCode) {
    notify('That code does not match. Check the six digits and try again.');
    return;
  }
  showAuthPanel('signin');
  notify('Password reset complete. Sign in with your new password.');
});

document.querySelector('[data-action="resend-code"]')?.addEventListener('click', () => {
  pendingCode = createCode();
  showDemoCode('demo-code', pendingCode, 'For this local prototype,');
  notify('A new verification code was generated.');
});

document.querySelectorAll('[data-setup-next]').forEach(button => button.addEventListener('click', () => {
  if (setupStep === 1 && !setupForm.elements.name.value.trim()) {
    setupForm.elements.name.focus();
    return;
  }
  if (setupStep === 1 && !setupForm.elements.className.value.trim()) {
    setupForm.elements.className.focus();
    return;
  }
  if (setupStep === 2 && subjects.length === 0) {
    document.querySelector('#subject-input').focus();
    notify('Add at least one subject to shape your workspace.');
    return;
  }
  setSetupStep(setupStep + 1);
}));

document.querySelectorAll('[data-setup-back]').forEach(button => button.addEventListener('click', () => setSetupStep(setupStep - 1)));

document.querySelector('[data-add-subject]')?.addEventListener('click', () => {
  const input = document.querySelector('#subject-input');
  const subject = input.value.trim();
  if (!subject) return input.focus();
  if (!subjects.includes(subject)) subjects.push(subject);
  input.value = '';
  renderSetupSubjects();
  input.focus();
});

document.querySelector('#subject-input')?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    document.querySelector('[data-add-subject]').click();
  }
});

setupForm?.addEventListener('submit', event => {
  event.preventDefault();
  const scheme = document.querySelector('#scheme-input').value.trim();
  if (!scheme) {
    document.querySelector('#scheme-input').focus();
    notify('Paste a scheme of work so I can find your topics.');
    return;
  }
  setSetupStep(4);
  window.setTimeout(() => {
    const topicCount = Math.max(3, scheme.split('\n').filter(line => line.trim()).length * 2);
    document.querySelector('#result-subject-count').textContent = `${subjects.length} subject${subjects.length === 1 ? '' : 's'}`;
    document.querySelector('#result-topic-count').textContent = `${topicCount} topics`;
    setSetupStep(5);
  }, 1500);
});

document.querySelector('[data-finish-setup]')?.addEventListener('click', finishOnboarding);

function responseFor(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes('simple')) return 'Think of a Punnett square as a small possibility map. Put one parent’s alleles across the top and the other parent’s down the side, then combine the pair in each box.';
  if (text.includes('hint')) return 'Start by writing the alleles each parent can pass on. What letters would you put along the top and the left side?';
  if (text.includes('test')) return 'Let’s check your understanding: if both parents are Bb, which genotype is impossible for their child: BB, Bb, or bb? Explain how you know.';
  return 'A Punnett square maps the possible allele combinations from two parents. Each box represents one possible genotype, not a guaranteed outcome. Want to try one together?';
}

function addUserMessage(text) {
  const messages = document.querySelector('#messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'message user-message';
  wrapper.innerHTML = `<div><p>${escapeHtml(text)}</p><time>Now</time></div>`;
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

function addTutorMessage(text) {
  const messages = document.querySelector('#messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'message tutor-message';
  wrapper.innerHTML = `<span class="message-avatar">✦</span><div><p>${escapeHtml(text)}</p><time>Now</time></div>`;
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

document.querySelector('#chat-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addUserMessage(text);
  window.setTimeout(() => addTutorMessage(responseFor(text)), 450);
});
