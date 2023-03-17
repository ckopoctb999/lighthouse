/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {Audit} from './audit.js';
import * as i18n from '../lib/i18n/i18n.js';
import {LargestContentfulPaint} from '../computed/metrics/largest-contentful-paint.js';
import {ProcessedNavigation} from '../computed/processed-navigation.js';
import PrioritizeLcpImage from './prioritize-lcp-image.js';
import {NetworkRecords} from '../computed/network-records.js';
import {MainResource} from '../computed/main-resource.js';

const UIStrings = {
  /** Descriptive title of a diagnostic audit that provides the element that was determined to be the Largest Contentful Paint. */
  title: 'Largest Contentful Paint element',
  /** Description of a Lighthouse audit that tells the user that the element shown was determined to be the Largest Contentful Paint. */
  description: 'This is the largest contentful element painted within the viewport. ' +
    '[Learn more about the Largest Contentful Paint element](https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint/)',
};

const str_ = i18n.createIcuMessageFn(import.meta.url, UIStrings);

class LargestContentfulPaintElement extends Audit {
  /**
   * @return {LH.Audit.Meta}
   */
  static get meta() {
    return {
      id: 'largest-contentful-paint-element',
      title: str_(UIStrings.title),
      description: str_(UIStrings.description),
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      supportedModes: ['navigation'],
      requiredArtifacts:
        ['traces', 'TraceElements', 'devtoolsLogs', 'GatherContext', 'settings', 'URL'],
    };
  }

  /**
   * @param {LH.Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Promise<LH.Audit.Details.Table|undefined>}
   */
  static async makePhaseTable(artifacts, context) {
    const trace = artifacts.traces[Audit.DEFAULT_PASS];
    const devtoolsLog = artifacts.devtoolsLogs[Audit.DEFAULT_PASS];
    const gatherContext = artifacts.GatherContext;
    const metricComputationData = {trace, devtoolsLog, gatherContext,
      settings: context.settings, URL: artifacts.URL};

    const networkRecords = await NetworkRecords.request(devtoolsLog, context);
    const processedNavigation = await ProcessedNavigation.request(trace, context);
    const metricResult = await LargestContentfulPaint.request(metricComputationData, context);
    const mainResource = await MainResource.request(metricComputationData, context);

    const lcpRecord = PrioritizeLcpImage.getLcpRecord(trace, processedNavigation, networkRecords);
    if (!lcpRecord) return;

    const timeOriginTs = processedNavigation.timestamps.timeOrigin;
    const firstByteTs = mainResource.responseHeadersEndTime * 1000;

    /** @type {number|undefined} */
    let lcpLoadStartTs = undefined;
    /** @type {number|undefined} */
    let lcpLoadEndTs = undefined;

    if ('pessimisticEstimate' in metricResult) {
      for (const [node, timing] of metricResult.pessimisticEstimate.nodeTimings) {
        if (node.type === 'network' &&
            node.record.requestId === lcpRecord.requestId) {
          lcpLoadStartTs = timing.startTime * 1000 + timeOriginTs;
          lcpLoadEndTs = timing.endTime * 1000 + timeOriginTs;
        }
      }
    } else {
      lcpLoadStartTs = lcpRecord.networkRequestTime * 1000;
      lcpLoadEndTs = lcpRecord.networkEndTime * 1000;
    }

    if (!lcpLoadStartTs || !lcpLoadEndTs) return;

    // Technically TTFB is calculated from when the main document request was initiated, not the last navigation start event.
    // However, our LCP is calculated from the last navigation start event and we want these phases to always add up to LCP.
    // In theory, the difference between the initial request time and navigation start event should be small.
    const ttfb = (firstByteTs - timeOriginTs) / 1000;

    const loadDelay = (lcpLoadStartTs - firstByteTs) / 1000;
    const loadTime = (lcpLoadEndTs - lcpLoadStartTs) / 1000;
    const renderDelay = metricResult.timing - loadTime - loadDelay - ttfb;

    const results = [
      {phase: 'TTFB', timing: ttfb},
      {phase: 'Load Delay', timing: loadDelay},
      {phase: 'Load Time', timing: loadTime},
      {phase: 'Render Delay', timing: renderDelay},
    ].map(result => {
      const percent = 100 * result.timing / metricResult.timing;
      const percentStr = `${percent.toFixed(2)}%`;
      return {...result, percent: percentStr};
    });

    /** @type {LH.Audit.Details.Table['headings']} */
    const headings = [
      {key: 'phase', valueType: 'text', label: 'Phase'},
      {key: 'percent', valueType: 'text', label: '% of LCP'},
      {key: 'timing', valueType: 'ms', label: 'Timing'},
    ];

    return Audit.makeTableDetails(headings, results);
  }

  /**
   * @param {LH.Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Promise<LH.Audit.Product>}
   */
  static async audit(artifacts, context) {
    const lcpElement = artifacts.TraceElements
      .find(element => element.traceEventType === 'largest-contentful-paint');
    const lcpElementDetails = [];
    if (lcpElement) {
      lcpElementDetails.push({
        node: Audit.makeNodeItem(lcpElement.node),
      });
    }

    /** @type {LH.Audit.Details.Table['headings']} */
    const headings = [
      {key: 'node', valueType: 'node', label: str_(i18n.UIStrings.columnElement)},
    ];

    const elementTable = Audit.makeTableDetails(headings, lcpElementDetails);

    const items = [elementTable];
    const phaseTable = await this.makePhaseTable(artifacts, context);
    if (phaseTable) items.push(phaseTable);

    const details = Audit.makeListDetails(items);

    const displayValue = str_(i18n.UIStrings.displayValueElementsFound,
      {nodeCount: lcpElementDetails.length});

    return {
      score: 1,
      notApplicable: lcpElementDetails.length === 0,
      displayValue,
      details,
    };
  }
}

export default LargestContentfulPaintElement;
export {UIStrings};
