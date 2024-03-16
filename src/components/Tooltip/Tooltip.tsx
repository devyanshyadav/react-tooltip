import React, { useEffect, useState, useRef, useCallback, useImperativeHandle } from 'react'
import { autoUpdate } from '@floating-ui/dom'
import clsx from 'clsx'
import {
  debounce,
  deepEqual,
  useIsomorphicLayoutEffect,
  getScrollParent,
  computeTooltipPosition,
  cssTimeToMs,
} from 'utils'
import type { IComputedPosition } from 'utils'
import coreStyles from './core-styles.module.css'
import styles from './styles.module.css'
import type {
  AnchorCloseEvents,
  AnchorOpenEvents,
  GlobalCloseEvents,
  IPosition,
  ITooltip,
  TooltipImperativeOpenOptions,
} from './TooltipTypes'

const Tooltip = ({
  // props
  forwardRef,
  id,
  className,
  classNameArrow,
  variant = 'dark',
  anchorSelect,
  place = 'top',
  offset = 10,
  openOnClick = false,
  positionStrategy = 'absolute',
  middlewares,
  wrapper: WrapperElement,
  delayShow = 0,
  delayHide = 0,
  float = false,
  hidden = false,
  noArrow = false,
  clickable = false,
  openEvents,
  closeEvents,
  globalCloseEvents,
  imperativeModeOnly,
  style: externalStyles,
  position,
  afterShow,
  afterHide,
  // props handled by controller
  content,
  contentWrapperRef,
  isOpen,
  defaultIsOpen = false,
  setIsOpen,
  activeAnchor,
  setActiveAnchor,
  border,
  opacity,
  arrowColor,
  role = 'tooltip',
}: ITooltip) => {
  const tooltipRef = useRef<HTMLElement>(null)
  const tooltipArrowRef = useRef<HTMLElement>(null)
  const tooltipShowDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tooltipHideDelayTimerRef = useRef<NodeJS.Timeout | null>(null)
  const missedTransitionTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [computedPosition, setComputedPosition] = useState<IComputedPosition>({
    tooltipStyles: {},
    tooltipArrowStyles: {},
    place,
  })
  const [show, setShow] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [imperativeOptions, setImperativeOptions] = useState<TooltipImperativeOpenOptions | null>(
    null,
  )
  const wasShowing = useRef(false)
  const lastFloatPosition = useRef<IPosition | null>(null)
  const hoveringTooltip = useRef(false)
  const [anchorElements, setAnchorElements] = useState<HTMLElement[]>([])
  const mounted = useRef(false)

  /**
   * useLayoutEffect runs before useEffect,
   * but should be used carefully because of caveats
   * https://beta.reactjs.org/reference/react/useLayoutEffect#caveats
   */
  useIsomorphicLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleShow = useCallback(
    (value: boolean) => {
      if (!mounted.current) {
        return
      }
      if (value) {
        setRendered(true)
      }
      /**
       * wait for the component to render and calculate position
       * before actually showing
       */
      setTimeout(() => {
        if (!mounted.current) {
          return
        }
        setIsOpen?.(value)
        if (isOpen === undefined) {
          setShow(value)
        }
      }, 10)
    },
    [isOpen, setIsOpen],
  )

  /**
   * this replicates the effect from `handleShow()`
   * when `isOpen` is changed from outside
   */
  useEffect(() => {
    if (isOpen === undefined) {
      return () => null
    }
    if (isOpen) {
      setRendered(true)
    }
    const timeout = setTimeout(() => {
      setShow(isOpen)
    }, 10)
    return () => {
      clearTimeout(timeout)
    }
  }, [isOpen])

  useEffect(() => {
    if (show === wasShowing.current) {
      return
    }
    if (missedTransitionTimerRef.current) {
      clearTimeout(missedTransitionTimerRef.current)
    }
    wasShowing.current = show
    if (show) {
      afterShow?.()
    } else {
      /**
       * see `onTransitionEnd` on tooltip wrapper
       */
      const style = getComputedStyle(document.body)
      const transitionShowDelay = cssTimeToMs(style.getPropertyValue('--rt-transition-show-delay'))
      missedTransitionTimerRef.current = setTimeout(() => {
        /**
         * if the tooltip switches from `show === true` to `show === false` too fast
         * the transition never runs, so `onTransitionEnd` callback never gets fired
         */
        setRendered(false)
        setImperativeOptions(null)
        afterHide?.()
        // +25ms just to make sure `onTransitionEnd` (if it gets fired) has time to run
      }, transitionShowDelay + 25)
    }
  }, [afterHide, afterShow, show])

  const handleComputedPosition = (newComputedPosition: IComputedPosition) => {
    setComputedPosition((oldComputedPosition) =>
      deepEqual(oldComputedPosition, newComputedPosition)
        ? oldComputedPosition
        : newComputedPosition,
    )
  }

  const handleShowTooltipDelayed = useCallback(
    (delay = delayShow) => {
      if (tooltipShowDelayTimerRef.current) {
        clearTimeout(tooltipShowDelayTimerRef.current)
      }

      if (rendered) {
        // if the tooltip is already rendered, ignore delay
        handleShow(true)
        return
      }

      tooltipShowDelayTimerRef.current = setTimeout(() => {
        handleShow(true)
      }, delay)
    },
    [delayShow, handleShow, rendered],
  )

  const handleHideTooltipDelayed = useCallback(
    (delay = delayHide) => {
      if (tooltipHideDelayTimerRef.current) {
        clearTimeout(tooltipHideDelayTimerRef.current)
      }

      tooltipHideDelayTimerRef.current = setTimeout(() => {
        if (hoveringTooltip.current) {
          return
        }
        handleShow(false)
      }, delay)
    },
    [delayHide, handleShow],
  )

  const handleTooltipPosition = useCallback(
    ({ x, y }: IPosition) => {
      const virtualElement = {
        getBoundingClientRect() {
          return {
            x,
            y,
            width: 0,
            height: 0,
            top: y,
            left: x,
            right: x,
            bottom: y,
          }
        },
      } as Element
      computeTooltipPosition({
        place: imperativeOptions?.place ?? place,
        offset,
        elementReference: virtualElement,
        tooltipReference: tooltipRef.current,
        tooltipArrowReference: tooltipArrowRef.current,
        strategy: positionStrategy,
        middlewares,
        border,
      }).then((computedStylesData) => {
        handleComputedPosition(computedStylesData)
      })
    },
    [imperativeOptions?.place, place, offset, positionStrategy, middlewares, border],
  )

  const updateTooltipPosition = useCallback(() => {
    const actualPosition = imperativeOptions?.position ?? position
    if (actualPosition) {
      // if `position` is set, override regular and `float` positioning
      handleTooltipPosition(actualPosition)
      return
    }

    if (float) {
      if (lastFloatPosition.current) {
        /*
          Without this, changes to `content`, `place`, `offset`, ..., will only
          trigger a position calculation after a `mousemove` event.

          To see why this matters, comment this line, run `yarn dev` and click the
          "Hover me!" anchor.
        */
        handleTooltipPosition(lastFloatPosition.current)
      }
      // if `float` is set, override regular positioning
      return
    }

    if (!activeAnchor?.isConnected) {
      return
    }

    computeTooltipPosition({
      place: imperativeOptions?.place ?? place,
      offset,
      elementReference: activeAnchor,
      tooltipReference: tooltipRef.current,
      tooltipArrowReference: tooltipArrowRef.current,
      strategy: positionStrategy,
      middlewares,
      border,
    }).then((computedStylesData) => {
      if (!mounted.current) {
        // invalidate computed positions after remount
        return
      }
      handleComputedPosition(computedStylesData)
    })
  }, [
    imperativeOptions?.position,
    imperativeOptions?.place,
    position,
    float,
    activeAnchor,
    place,
    offset,
    positionStrategy,
    middlewares,
    border,
    handleTooltipPosition,
  ])

  useEffect(() => {
    /**
     * TODO(V6): break this effect down into callbacks for clarity
     *   - `handleKeyboardEvents()`
     *   - `handleMouseEvents()`
     *   - `handleGlobalCloseEvents()`
     *   - `handleAnchorEvents()`
     *   - ...
     */

    const handlePointerMove = (event?: Event) => {
      if (!event) {
        return
      }
      const mouseEvent = event as MouseEvent
      const mousePosition = {
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      }
      handleTooltipPosition(mousePosition)
      lastFloatPosition.current = mousePosition
    }

    const handleClickOutsideAnchors = (event: MouseEvent) => {
      if (!show) {
        return
      }
      const target = event.target as HTMLElement
      if (!target.isConnected) {
        return
      }
      if (tooltipRef.current?.contains(target)) {
        return
      }
      if (anchorElements.some((anchor) => anchor?.contains(target))) {
        return
      }
      handleShow(false)
      if (tooltipShowDelayTimerRef.current) {
        clearTimeout(tooltipShowDelayTimerRef.current)
      }
    }

    const handleShowTooltip = (event?: Event) => {
      if (!event) {
        return
      }
      const target = (event.currentTarget ?? event.target) as HTMLElement | null
      if (!target?.isConnected) {
        /**
         * this happens when the target is removed from the DOM
         * at the same time the tooltip gets triggered
         */
        setActiveAnchor(null)
        return
      }
      if (delayShow) {
        handleShowTooltipDelayed()
      } else {
        handleShow(true)
      }
      setActiveAnchor(target)

      if (tooltipHideDelayTimerRef.current) {
        clearTimeout(tooltipHideDelayTimerRef.current)
      }
    }

    const handleHideTooltip = () => {
      if (clickable) {
        // allow time for the mouse to reach the tooltip, in case there's a gap
        handleHideTooltipDelayed(delayHide || 100)
      } else if (delayHide) {
        handleHideTooltipDelayed()
      } else {
        handleShow(false)
      }

      if (tooltipShowDelayTimerRef.current) {
        clearTimeout(tooltipShowDelayTimerRef.current)
      }
    }

    // debounce handler to prevent call twice when
    // mouse enter and focus events being triggered toggether
    const internalDebouncedHandleShowTooltip = debounce(handleShowTooltip, 50, true)
    const internalDebouncedHandleHideTooltip = debounce(handleHideTooltip, 50, true)
    // If either of the functions is called while the other is still debounced,
    // reset the timeout. Otherwise if there is a sub-50ms (leave A, enter B, leave B)
    // sequence of events, the tooltip will stay open because the hide debounce
    // from leave A prevented the leave B event from calling it, leaving the
    // tooltip visible.
    const debouncedHandleShowTooltip = (e?: Event) => {
      internalDebouncedHandleHideTooltip.cancel()
      internalDebouncedHandleShowTooltip(e)
    }
    const debouncedHandleHideTooltip = () => {
      internalDebouncedHandleShowTooltip.cancel()
      internalDebouncedHandleHideTooltip()
    }

    const handleScrollResize = () => {
      handleShow(false)
    }

    const hasClickEvent =
      openOnClick || openEvents?.click || openEvents?.dblclick || openEvents?.mousedown
    const actualOpenEvents: AnchorOpenEvents = openEvents
      ? { ...openEvents }
      : {
          mouseenter: true,
          focus: true,
          click: false,
          dblclick: false,
          mousedown: false,
        }
    if (!openEvents && openOnClick) {
      Object.assign(actualOpenEvents, {
        mouseenter: false,
        focus: false,
        click: true,
      })
    }
    const actualCloseEvents: AnchorCloseEvents = closeEvents
      ? { ...closeEvents }
      : {
          mouseleave: true,
          blur: true,
          click: false,
          dblclick: false,
          mouseup: false,
        }
    if (!closeEvents && openOnClick) {
      Object.assign(actualCloseEvents, {
        mouseleave: false,
        blur: false,
      })
    }
    const actualGlobalCloseEvents: GlobalCloseEvents = globalCloseEvents
      ? { ...globalCloseEvents }
      : {
          escape: false,
          scroll: false,
          resize: false,
          clickOutsideAnchor: hasClickEvent || false,
        }

    if (imperativeModeOnly) {
      Object.assign(actualOpenEvents, {
        mouseenter: false,
        focus: false,
        click: false,
        dblclick: false,
        mousedown: false,
      })
      Object.assign(actualCloseEvents, {
        mouseleave: false,
        blur: false,
        click: false,
        dblclick: false,
        mouseup: false,
      })
      Object.assign(actualGlobalCloseEvents, {
        escape: false,
        scroll: false,
        resize: false,
        clickOutsideAnchor: false,
      })
    }

    const tooltipElement = tooltipRef.current
    const tooltipScrollParent = getScrollParent(tooltipRef.current)
    const anchorScrollParent = getScrollParent(activeAnchor)

    if (actualGlobalCloseEvents.scroll) {
      window.addEventListener('scroll', handleScrollResize)
      anchorScrollParent?.addEventListener('scroll', handleScrollResize)
      tooltipScrollParent?.addEventListener('scroll', handleScrollResize)
    }
    let updateTooltipCleanup: null | (() => void) = null
    if (actualGlobalCloseEvents.resize) {
      window.addEventListener('resize', handleScrollResize)
    } else if (activeAnchor && tooltipRef.current) {
      updateTooltipCleanup = autoUpdate(
        activeAnchor as HTMLElement,
        tooltipRef.current as HTMLElement,
        updateTooltipPosition,
        {
          ancestorResize: true,
          elementResize: true,
          layoutShift: true,
        },
      )
    }

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      handleShow(false)
    }
    if (actualGlobalCloseEvents.escape) {
      window.addEventListener('keydown', handleEsc)
    }

    if (actualGlobalCloseEvents.clickOutsideAnchor) {
      window.addEventListener('click', handleClickOutsideAnchors)
    }

    const enabledEvents: { event: string; listener: (event?: Event) => void }[] = []

    const handleClickOpenTooltipAnchor = (event?: Event) => {
      if (show && event?.target === activeAnchor) {
        /**
         * ignore clicking the anchor that was used to open the tooltip.
         * this avoids conflict with the click close event.
         */
        return
      }
      handleShowTooltip(event)
    }
    const handleClickCloseTooltipAnchor = (event?: Event) => {
      if (!show || event?.target !== activeAnchor) {
        /**
         * ignore clicking the anchor that was NOT used to open the tooltip.
         * this avoids closing the tooltip when clicking on a
         * new anchor with the tooltip already open.
         */
        return
      }
      handleHideTooltip()
    }

    const regularEvents = ['mouseenter', 'mouseleave', 'focus', 'blur']
    const clickEvents = ['click', 'dblclick', 'mousedown', 'mouseup']

    Object.entries(actualOpenEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({ event, listener: debouncedHandleShowTooltip })
      } else if (clickEvents.includes(event)) {
        enabledEvents.push({ event, listener: handleClickOpenTooltipAnchor })
      } else {
        // never happens
      }
    })

    Object.entries(actualCloseEvents).forEach(([event, enabled]) => {
      if (!enabled) {
        return
      }
      if (regularEvents.includes(event)) {
        enabledEvents.push({ event, listener: debouncedHandleHideTooltip })
      } else if (clickEvents.includes(event)) {
        enabledEvents.push({ event, listener: handleClickCloseTooltipAnchor })
      } else {
        // never happens
      }
    })

    if (float) {
      enabledEvents.push({
        event: 'pointermove',
        listener: handlePointerMove,
      })
    }

    const handleMouseEnterTooltip = () => {
      hoveringTooltip.current = true
    }
    const handleMouseLeaveTooltip = () => {
      hoveringTooltip.current = false
      handleHideTooltip()
    }

    if (clickable && !hasClickEvent) {
      // used to keep the tooltip open when hovering content.
      // not needed if using click events.
      tooltipElement?.addEventListener('mouseenter', handleMouseEnterTooltip)
      tooltipElement?.addEventListener('mouseleave', handleMouseLeaveTooltip)
    }

    enabledEvents.forEach(({ event, listener }) => {
      anchorElements.forEach((anchor) => {
        anchor.addEventListener(event, listener)
      })
    })

    return () => {
      if (actualGlobalCloseEvents.scroll) {
        window.removeEventListener('scroll', handleScrollResize)
        anchorScrollParent?.removeEventListener('scroll', handleScrollResize)
        tooltipScrollParent?.removeEventListener('scroll', handleScrollResize)
      }
      if (actualGlobalCloseEvents.resize) {
        window.removeEventListener('resize', handleScrollResize)
      } else {
        updateTooltipCleanup?.()
      }
      if (actualGlobalCloseEvents.clickOutsideAnchor) {
        window.removeEventListener('click', handleClickOutsideAnchors)
      }
      if (actualGlobalCloseEvents.escape) {
        window.removeEventListener('keydown', handleEsc)
      }
      if (clickable && !hasClickEvent) {
        tooltipElement?.removeEventListener('mouseenter', handleMouseEnterTooltip)
        tooltipElement?.removeEventListener('mouseleave', handleMouseLeaveTooltip)
      }
      enabledEvents.forEach(({ event, listener }) => {
        anchorElements.forEach((anchor) => {
          anchor.removeEventListener(event, listener)
        })
      })
    }
    /**
     * rendered is also a dependency to ensure anchor observers are re-registered
     * since `tooltipRef` becomes stale after removing/adding the tooltip to the DOM
     */
  }, [
    activeAnchor,
    anchorElements,
    clickable,
    closeEvents,
    delayHide,
    delayShow,
    float,
    globalCloseEvents,
    handleHideTooltipDelayed,
    handleShow,
    handleShowTooltipDelayed,
    handleTooltipPosition,
    imperativeModeOnly,
    openEvents,
    openOnClick,
    setActiveAnchor,
    show,
    updateTooltipPosition,
  ])

  useEffect(() => {
    /**
     * TODO(V6): break down observer callback for clarity
     *   - `handleAddedAnchors()`
     *   - `handleRemovedAnchors()`
     */
    let selector = imperativeOptions?.anchorSelect ?? anchorSelect ?? ''
    if (!selector && id) {
      selector = `[data-tooltip-id='${id.replace(/'/g, "\\'")}']`
    }
    const documentObserverCallback: MutationCallback = (mutationList) => {
      const addedAnchors = new Set<HTMLElement>()
      const removedAnchors = new Set<HTMLElement>()
      mutationList.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-tooltip-id') {
          const target = mutation.target as HTMLElement
          const newId = target.getAttribute('data-tooltip-id')
          if (newId === id) {
            addedAnchors.add(target)
          } else if (mutation.oldValue === id) {
            // data-tooltip-id has now been changed, so we need to remove this anchor
            removedAnchors.add(target)
          }
        }
        if (mutation.type !== 'childList') {
          return
        }
        const removedNodes = [...mutation.removedNodes].filter((node) => node.nodeType === 1)
        if (activeAnchor) {
          removedNodes.some((node) => {
            /**
             * TODO(V6)
             *   - isn't `!activeAnchor.isConnected` better?
             *   - maybe move to `handleDisconnectedAnchor()`
             */
            if (node?.contains?.(activeAnchor)) {
              setRendered(false)
              handleShow(false)
              setActiveAnchor(null)
              if (tooltipShowDelayTimerRef.current) {
                clearTimeout(tooltipShowDelayTimerRef.current)
              }
              if (tooltipHideDelayTimerRef.current) {
                clearTimeout(tooltipHideDelayTimerRef.current)
              }
              return true
            }
            return false
          })
        }
        if (!selector) {
          return
        }
        try {
          removedNodes.forEach((node) => {
            const element = node as HTMLElement
            if (element.matches(selector)) {
              // the element itself is an anchor
              removedAnchors.add(element)
            } else {
              /**
               * TODO(V6): do we care if an element which is an anchor,
               * has children which are also anchors?
               * (i.e. should we remove `else` and always do this)
               */
              // the element has children which are anchors
              element
                .querySelectorAll(selector)
                .forEach((innerNode) => removedAnchors.add(innerNode as HTMLElement))
            }
          })
        } catch {
          /* c8 ignore start */
          if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(`[react-tooltip] "${selector}" is not a valid CSS selector`)
          }
          /* c8 ignore end */
        }
        try {
          const addedNodes = [...mutation.addedNodes].filter((node) => node.nodeType === 1)
          addedNodes.forEach((node) => {
            const element = node as HTMLElement
            if (element.matches(selector)) {
              // the element itself is an anchor
              addedAnchors.add(element)
            } else {
              /**
               * TODO(V6): do we care if an element which is an anchor,
               * has children which are also anchors?
               * (i.e. should we remove `else` and always do this)
               */
              // the element has children which are anchors
              element
                .querySelectorAll(selector)
                .forEach((innerNode) => addedAnchors.add(innerNode as HTMLElement))
            }
          })
        } catch {
          /* c8 ignore start */
          if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(`[react-tooltip] "${selector}" is not a valid CSS selector`)
          }
          /* c8 ignore end */
        }
      })
      if (addedAnchors.size || removedAnchors.size) {
        setAnchorElements((anchors) => [
          ...anchors.filter((anchor) => !removedAnchors.has(anchor)),
          ...addedAnchors,
        ])
      }
    }
    const documentObserver = new MutationObserver(documentObserverCallback)
    // watch for anchor being removed from the DOM
    documentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tooltip-id'],
      // to track the prev value if we need to remove anchor when data-tooltip-id gets changed
      attributeOldValue: true,
    })
    return () => {
      documentObserver.disconnect()
    }
  }, [id, anchorSelect, imperativeOptions?.anchorSelect, activeAnchor, handleShow, setActiveAnchor])

  useEffect(() => {
    updateTooltipPosition()
  }, [updateTooltipPosition])

  useEffect(() => {
    if (!contentWrapperRef?.current) {
      return () => null
    }
    const contentObserver = new ResizeObserver(() => {
      setTimeout(() => updateTooltipPosition())
    })
    contentObserver.observe(contentWrapperRef.current)
    return () => {
      contentObserver.disconnect()
    }
  }, [content, contentWrapperRef, updateTooltipPosition])

  useEffect(() => {
    if (!activeAnchor || !anchorElements.includes(activeAnchor)) {
      /**
       * if there is no active anchor,
       * or if the current active anchor is not amongst the allowed ones,
       * reset it
       */
      setActiveAnchor(anchorElements[0] ?? null)
    }
  }, [anchorElements, activeAnchor, setActiveAnchor])

  useEffect(() => {
    if (defaultIsOpen) {
      handleShow(true)
    }
    return () => {
      if (tooltipShowDelayTimerRef.current) {
        clearTimeout(tooltipShowDelayTimerRef.current)
      }
      if (tooltipHideDelayTimerRef.current) {
        clearTimeout(tooltipHideDelayTimerRef.current)
      }
    }
  }, [defaultIsOpen, handleShow])

  useEffect(() => {
    let selector = imperativeOptions?.anchorSelect ?? anchorSelect
    if (!selector && id) {
      selector = `[data-tooltip-id='${id.replace(/'/g, "\\'")}']`
    }
    if (!selector) {
      return
    }
    try {
      const anchors = Array.from(document.querySelectorAll<HTMLElement>(selector))
      setAnchorElements(anchors)
    } catch {
      // warning was already issued in the controller
      setAnchorElements([])
    }
  }, [id, anchorSelect, imperativeOptions?.anchorSelect])

  useEffect(() => {
    if (tooltipShowDelayTimerRef.current) {
      clearTimeout(tooltipShowDelayTimerRef.current)
      handleShowTooltipDelayed(delayShow)
    }
  }, [delayShow, handleShowTooltipDelayed])

  const actualContent = imperativeOptions?.content ?? content
  const canShow = show && Object.keys(computedPosition.tooltipStyles).length > 0

  useImperativeHandle(forwardRef, () => ({
    open: (options) => {
      if (options?.anchorSelect) {
        try {
          document.querySelector(options.anchorSelect)
        } catch {
          if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(`[react-tooltip] "${options.anchorSelect}" is not a valid CSS selector`)
          }
          return
        }
      }
      setImperativeOptions(options ?? null)
      if (options?.delay) {
        handleShowTooltipDelayed(options.delay)
      } else {
        handleShow(true)
      }
    },
    close: (options) => {
      if (options?.delay) {
        handleHideTooltipDelayed(options.delay)
      } else {
        handleShow(false)
      }
    },
    activeAnchor,
    place: computedPosition.place,
    isOpen: Boolean(rendered && !hidden && actualContent && canShow),
  }))

  return rendered && !hidden && actualContent ? (
    <WrapperElement
      id={id}
      role={role}
      className={clsx(
        'react-tooltip',
        coreStyles['tooltip'],
        styles['tooltip'],
        styles[variant],
        className,
        `react-tooltip__place-${computedPosition.place}`,
        coreStyles[canShow ? 'show' : 'closing'],
        canShow ? 'react-tooltip__show' : 'react-tooltip__closing',
        positionStrategy === 'fixed' && coreStyles['fixed'],
        clickable && coreStyles['clickable'],
      )}
      onTransitionEnd={(event: TransitionEvent) => {
        if (missedTransitionTimerRef.current) {
          clearTimeout(missedTransitionTimerRef.current)
        }
        if (show || event.propertyName !== 'opacity') {
          return
        }
        setRendered(false)
        setImperativeOptions(null)
        afterHide?.()
      }}
      style={{
        ...externalStyles,
        ...computedPosition.tooltipStyles,
        opacity: opacity !== undefined && canShow ? opacity : undefined,
      }}
      ref={tooltipRef}
    >
      {actualContent}
      <WrapperElement
        className={clsx(
          'react-tooltip-arrow',
          coreStyles['arrow'],
          styles['arrow'],
          classNameArrow,
          noArrow && coreStyles['noArrow'],
        )}
        style={{
          ...computedPosition.tooltipArrowStyles,
          background: arrowColor
            ? `linear-gradient(to right bottom, transparent 50%, ${arrowColor} 50%)`
            : undefined,
        }}
        ref={tooltipArrowRef}
      />
    </WrapperElement>
  ) : null
}

export default Tooltip
