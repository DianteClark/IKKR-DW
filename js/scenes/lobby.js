import { registerScene, go } from '../main.js';
import { h, btn, mount } from '../engine/ui.js';
registerScene('lobby', { enter() { mount(h('div', { class: 'screen center' }, h('div', { class: 'panel col' }, h('h2', {}, 'Coming soon'), btn('Back', () => go('title'))))); } });
