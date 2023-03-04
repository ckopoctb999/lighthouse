/**
 * @license Copyright 2019 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

/* global getNodeDetails */

import FRGatherer from '../base-gatherer.js';
import {pageFunctions} from '../../lib/page-functions.js';
import {resolveDevtoolsNodePathToObjectId} from '../driver/dom.js';

/* eslint-env browser, node */

/**
 * Function that is stringified and run in the page to collect anchor elements.
 * Additional complexity is introduced because anchors can be HTML or SVG elements.
 *
 * We use this evaluateAsync method because the `node.getAttribute` method doesn't actually normalize
 * the values like access from JavaScript in-page does.
 *
 * @return {LH.Artifacts['AnchorElements']}
 */
/* c8 ignore start */
function collectAnchorElements() {
  /** @param {string} url */
  const resolveURLOrEmpty = url => {
    try {
      return new URL(url, window.location.href).href;
    } catch (_) {
      return '';
    }
  };

  /** @param {HTMLAnchorElement|SVGAElement} node */
  function getTruncatedOnclick(node) {
    const onclick = node.getAttribute('onclick') || '';
    return onclick.slice(0, 1024);
  }

  /** @param {HTMLAnchorElement|SVGAElement} node */
  function getTextLang(node) {
    let parentLangEl;
    let linkLang;
    let innerElsWithLang;
    let innerTextEqualsLinkText;

    if (node instanceof HTMLAnchorElement) {
      parentLangEl = node.closest('[lang]');
      linkLang = !parentLangEl ? '' : parentLangEl.lang;
      innerElsWithLang = node.querySelectorAll('[lang]');
    } else {
      parentLangEl = node.closest('[*|lang]');
      linkLang = !parentLangEl ? ''
        : parentLangEl.getAttribute('lang') ||
          parentLangEl.getAttribute('xml:lang');
      innerElsWithLang = node.querySelectorAll('[*|lang]');
    }

    let innerTextLang = linkLang;

    if (innerElsWithLang.length) {
      if (innerElsWithLang.length > 1) {
        // TODO: not sure, what to do with mixed languages in link text
        innerTextLang = '';
      } else {
        const firstEl = innerElsWithLang[0];
        if (node instanceof HTMLAnchorElement) {
          innerTextEqualsLinkText = firstEl.innerText.trim() === node.innerText.trim();
        } else {
          innerTextEqualsLinkText = firstEl.textContent.trim() === node.textContent.trim();
        }
        if (innerTextEqualsLinkText) {
          innerTextLang = innerElsWithLang[0].getAttribute('lang') ||
            innerElsWithLang[0].getAttribute('xml:lang');
        } else {
          // TODO: not sure, what to do
          innerTextLang = '';
        }
      }
    }

    return innerTextLang;
  }

  /** @type {Array<HTMLAnchorElement|SVGAElement>} */
  // @ts-expect-error - put into scope via stringification
  const anchorElements = getElementsInDocument('a'); // eslint-disable-line no-undef

  return anchorElements.map(node => {
    if (node instanceof HTMLAnchorElement) {
      return {
        href: node.href,
        rawHref: node.getAttribute('href') || '',
        onclick: getTruncatedOnclick(node),
        role: node.getAttribute('role') || '',
        name: node.name,
        text: node.innerText, // we don't want to return hidden text, so use innerText
        textLang: getTextLang(node),
        rel: node.rel,
        target: node.target,
        // @ts-expect-error - getNodeDetails put into scope via stringification
        node: getNodeDetails(node),
      };
    }

    return {
      href: resolveURLOrEmpty(node.href.baseVal),
      rawHref: node.getAttribute('href') || node.getAttribute('xlink:href') || '',
      onclick: getTruncatedOnclick(node),
      role: node.getAttribute('role') || '',
      text: node.textContent || '',
      textLang: getTextLang(node) || '',
      rel: '',
      target: node.target.baseVal || '',
      // @ts-expect-error - getNodeDetails put into scope via stringification
      node: getNodeDetails(node),
    };
  });
}
/* c8 ignore stop */

/**
 * @param {LH.Gatherer.FRProtocolSession} session
 * @param {string} devtoolsNodePath
 * @return {Promise<Array<{type: string}>>}
 */
async function getEventListeners(session, devtoolsNodePath) {
  const objectId = await resolveDevtoolsNodePathToObjectId(session, devtoolsNodePath);
  if (!objectId) return [];

  const response = await session.sendCommand('DOMDebugger.getEventListeners', {
    objectId,
  });

  return response.listeners.map(({type}) => ({type}));
}

class AnchorElements extends FRGatherer {
  /** @type {LH.Gatherer.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {LH.Gatherer.FRTransitionalContext} passContext
   * @return {Promise<LH.Artifacts['AnchorElements']>}
   */
  async getArtifact(passContext) {
    const session = passContext.driver.defaultSession;

    const anchors = await passContext.driver.executionContext.evaluate(collectAnchorElements, {
      args: [],
      useIsolation: true,
      deps: [
        pageFunctions.getElementsInDocument,
        pageFunctions.getNodeDetails,
      ],
    });
    await session.sendCommand('DOM.enable');

    // DOM.getDocument is necessary for pushNodesByBackendIdsToFrontend to properly retrieve nodeIds if the `DOM` domain was enabled before this gatherer, invoke it to be safe.
    await session.sendCommand('DOM.getDocument', {depth: -1, pierce: true});
    const anchorsWithEventListeners = anchors.map(async anchor => {
      const listeners = await getEventListeners(session, anchor.node.devtoolsNodePath);

      return {
        ...anchor,
        listeners,
      };
    });

    const result = await Promise.all(anchorsWithEventListeners);
    await session.sendCommand('DOM.disable');
    return result;
  }
}

export default AnchorElements;
