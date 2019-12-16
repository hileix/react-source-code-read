/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint valid-typeof: 0 */

import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';

// 事件池可容纳的最大合成事件实例个数： 10 个 
const EVENT_POOL_SIZE = 10;

/**
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
// 事件接口
const EventInterface = {
  type: null,
  target: null,
  // currentTarget is set when dispatching; no use in copying it here
  currentTarget: function() {
    return null;
  },
  eventPhase: null,
  bubbles: null,
  cancelable: null,
  timeStamp: function(event) {
    return event.timeStamp || Date.now();
  },
  defaultPrevented: null,
  isTrusted: null,
};

function functionThatReturnsTrue() {
  return true;
}

function functionThatReturnsFalse() {
  return false;
}

/**
 * Synthetic events are dispatched by event plugins, typically in response to a
 * top-level event delegation handler.
 *
 * These systems should generally use pooling to reduce the frequency of garbage
 * collection. The system should check `isPersistent` to determine whether the
 * event should be released into the pool after being dispatched. Users that
 * need a persisted event should invoke `persist`.
 *
 * Synthetic events (and subclasses) implement the DOM Level 3 Events API by
 * normalizing browser quirks. Subclasses do not necessarily have to implement a
 * DOM interface; custom application-specific events can also subclass this.
 *
 * @param {object} dispatchConfig Configuration used to dispatch this event.
 * @param {*} targetInst Marker identifying the event target.
 * @param {object} nativeEvent Native browser event.
 * @param {DOMEventTarget} nativeEventTarget Target node.
 */
function SyntheticEvent(
  dispatchConfig,
  targetInst,
  nativeEvent,
  nativeEventTarget,
) {
  if (__DEV__) {
    // these have a getter/setter for warnings
    delete this.nativeEvent;
    delete this.preventDefault;
    delete this.stopPropagation;
    delete this.isDefaultPrevented;
    delete this.isPropagationStopped;
  }

  this.dispatchConfig = dispatchConfig;
  this._targetInst = targetInst;
  this.nativeEvent = nativeEvent;

  const Interface = this.constructor.Interface;
  for (const propName in Interface) {
    if (!Interface.hasOwnProperty(propName)) {
      continue;
    }
    if (__DEV__) {
      delete this[propName]; // this has a getter/setter for warnings
    }
    const normalize = Interface[propName];
    if (normalize) {
      this[propName] = normalize(nativeEvent);
    } else {
      if (propName === 'target') {
        this.target = nativeEventTarget;
      } else {
        this[propName] = nativeEvent[propName];
      }
    }
  }

  const defaultPrevented =
    nativeEvent.defaultPrevented != null
      ? nativeEvent.defaultPrevented
      : nativeEvent.returnValue === false;
  if (defaultPrevented) {
    this.isDefaultPrevented = functionThatReturnsTrue;
  } else {
    this.isDefaultPrevented = functionThatReturnsFalse;
  }
  this.isPropagationStopped = functionThatReturnsFalse;
  return this;
}

// 给 SyntheticEvent（合成事件类）添加方法
Object.assign(SyntheticEvent.prototype, {
  // 阻止默认事件方法
  preventDefault: function() {
    // SyntheticEvent.defaultPrevented 值设置为 true
    this.defaultPrevented = true;
    // 取出原生 event 对象
    const event = this.nativeEvent;
    if (!event) {
      return;
    }

    // 原生的 preventDefault 方法存在的话，直接调用
    if (event.preventDefault) {
      event.preventDefault();
    } else if (typeof event.returnValue !== 'unknown') {
      // 不存在的话，直接设置 returnValue 值为 false
      event.returnValue = false;
    }
    // SyntheticEvent.isDefaultPrevented 方法设置为一直返回 true 的方法
    this.isDefaultPrevented = functionThatReturnsTrue;
  },
  // 停止事件冒泡方法
  stopPropagation: function() {
    // 取出原生 event 对象
    const event = this.nativeEvent;
    if (!event) {
      return;
    }
    // 原生的 stopPropagation 方法存在的话，直接调用
    if (event.stopPropagation) {
      event.stopPropagation();
    } else if (typeof event.cancelBubble !== 'unknown') {
      // The ChangeEventPlugin registers a "propertychange" event for
      // IE. This event does not support bubbling or cancelling, and
      // any references to cancelBubble throw "Member not found".  A
      // typeof check of "unknown" circumvents this issue (and is also
      // IE specific).
      // 不存在的话，直接设置 cancelBubble 值为 true
      event.cancelBubble = true;
    }

    // SyntheticEvent.isPropagationStopped 方法设置为一直返回 true 的方法
    this.isPropagationStopped = functionThatReturnsTrue;
  },

  /**
   * We release all dispatched `SyntheticEvent`s after each event loop, adding
   * them back into the pool. This allows a way to hold onto a reference that
   * won't be added back into the pool.
   */
  // SyntheticEvent.isPersistent 设置为一个一直返回 true 的方法
  // 为了阻止将合成事件实例放回事件池中
  persist: function() {
    this.isPersistent = functionThatReturnsTrue;
  },

  /**
   * Checks if this event should be released back into the pool.
   *
   * @return {boolean} True if this should not be released, false otherwise.
   */
  // 检查事件是否应该被释放到事件池中
  // false 表示应该被释放到事件池中，true 表示不应该释放到事件池中
  isPersistent: functionThatReturnsFalse,

  /**
   * `PooledClass` looks for `destructor` on each instance it releases.
   */
  destructor: function() {
    const Interface = this.constructor.Interface;
    // 将所有的 Interface 的属性值都设为 null
    for (const propName in Interface) {
      if (__DEV__) {
        Object.defineProperty(
          this,
          propName,
          getPooledWarningPropertyDefinition(propName, Interface[propName]),
        );
      } else {
        this[propName] = null;
      }
    }
    // 将合成事件实例的 dispatchConfig, _targetInst, nativeEvent 设置为 null
    this.dispatchConfig = null;
    this._targetInst = null;
    this.nativeEvent = null;
    // 将合成事件实例的 isDefaultPrevented, isPropagationStopped 方法设置为返回 false 的方法
    this.isDefaultPrevented = functionThatReturnsFalse;
    this.isPropagationStopped = functionThatReturnsFalse;
    // 将合成事件实例的 d_dispatchListeners, _dispatchInstances 设置为 null
    this._dispatchListeners = null;
    this._dispatchInstances = null;
    if (__DEV__) {
      Object.defineProperty(
        this,
        'nativeEvent',
        getPooledWarningPropertyDefinition('nativeEvent', null),
      );
      Object.defineProperty(
        this,
        'isDefaultPrevented',
        getPooledWarningPropertyDefinition(
          'isDefaultPrevented',
          functionThatReturnsFalse,
        ),
      );
      Object.defineProperty(
        this,
        'isPropagationStopped',
        getPooledWarningPropertyDefinition(
          'isPropagationStopped',
          functionThatReturnsFalse,
        ),
      );
      Object.defineProperty(
        this,
        'preventDefault',
        getPooledWarningPropertyDefinition('preventDefault', () => {}),
      );
      Object.defineProperty(
        this,
        'stopPropagation',
        getPooledWarningPropertyDefinition('stopPropagation', () => {}),
      );
    }
  },
});

// 事件接口
SyntheticEvent.Interface = EventInterface;

/**
 * Helper to reduce boilerplate when creating subclasses.
 */
// 传入 Interface
// 以 SyntheticEvent 为父类型，使用 寄生组合式继承 来返回子类
// 同时通过传入的 Interface 增强子类的 Interface 静态对象
SyntheticEvent.extend = function(Interface) {
  const Super = this;

  const E = function() {};
  E.prototype = Super.prototype;
  const prototype = new E();

  function Class() {
    return Super.apply(this, arguments);
  }
  Object.assign(prototype, Class.prototype);
  Class.prototype = prototype;
  Class.prototype.constructor = Class;

  Class.Interface = Object.assign({}, Super.Interface, Interface);
  Class.extend = Super.extend;
  addEventPoolingTo(Class);

  return Class;
};

addEventPoolingTo(SyntheticEvent);

/**
 * Helper to nullify syntheticEvent instance properties when destructing
 *
 * @param {String} propName
 * @param {?object} getVal
 * @return {object} defineProperty object
 */
function getPooledWarningPropertyDefinition(propName, getVal) {
  const isFunction = typeof getVal === 'function';
  return {
    configurable: true,
    set: set,
    get: get,
  };

  function set(val) {
    const action = isFunction ? 'setting the method' : 'setting the property';
    warn(action, 'This is effectively a no-op');
    return val;
  }

  function get() {
    const action = isFunction
      ? 'accessing the method'
      : 'accessing the property';
    const result = isFunction
      ? 'This is a no-op function'
      : 'This is set to null';
    warn(action, result);
    return getVal;
  }

  function warn(action, result) {
    const warningCondition = false;
    warningWithoutStack(
      warningCondition,
      "This synthetic event is reused for performance reasons. If you're seeing this, " +
        "you're %s `%s` on a released/nullified synthetic event. %s. " +
        'If you must keep the original synthetic event around, use event.persist(). ' +
        'See https://fb.me/react-event-pooling for more information.',
      action,
      propName,
      result,
    );
  }
}

// 获取事件池中的合成事件实例
function getPooledEvent(dispatchConfig, targetInst, nativeEvent, nativeInst) {
  // 类构造函数
  const EventConstructor = this;
  // 如果 eventPool 数组合成实例元素
  if (EventConstructor.eventPool.length) {
    // 拿出最后一个合成事件实例元素
    const instance = EventConstructor.eventPool.pop();
    // 调用 合成函数构造函数，更新 合成事件实例 中的 dispatchConfig/_targetInst/nativeEvent 属性
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
    );
    // 返回该合成事件实例
    return instance;
  }
  // 不存在，则 new 一个合成事件实例
  return new EventConstructor(
    dispatchConfig,
    targetInst,
    nativeEvent,
    nativeInst,
  );
}

// 释放合成事件实例
// event 为合成事件实例
function releasePooledEvent(event) {
  // 合成事件类
  const EventConstructor = this;
  invariant(
    event instanceof EventConstructor,
    'Trying to release an event instance into a pool of a different type.',
  );
  // 调用合成事件实例的 destructor，销毁合成事件的属性和方法
  event.destructor();
  // 如果
  // 当前事件池已有合成事件实例个数 小于 事件池容量
  if (EventConstructor.eventPool.length < EVENT_POOL_SIZE) {
    // 则将上面的合成事件实例 push 进事件池中，以重复使用
    EventConstructor.eventPool.push(event);
  }
}
// 给合成事件类添加事件池相关的属性和方法
// 添加 1 个静态属性：eventPool
// 添加了 2 个静态方法：getPooledEvent、releasePooledEvent
function addEventPoolingTo(EventConstructor) {
  EventConstructor.eventPool = [];
  EventConstructor.getPooled = getPooledEvent;
  EventConstructor.release = releasePooledEvent;
}

export default SyntheticEvent;
