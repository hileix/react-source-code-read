/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import SyntheticMouseEvent from './SyntheticMouseEvent';

/**
 * @interface DragEvent
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
// drag 合成事件类
const SyntheticDragEvent = SyntheticMouseEvent.extend({
  dataTransfer: null,
});

export default SyntheticDragEvent;
