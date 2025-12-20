import { render } from 'preact';

import { App } from './App';
import './popup.css';

document.title = chrome.i18n.getMessage('app_name_full');
document.documentElement.lang = chrome.i18n.getMessage('html_lang');

const root = document.getElementById('root');

if (root) {
  render(<App />, root);
}
