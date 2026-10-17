// IVE — fn-listener
// A tiny global gesture tap for macOS.
//
// Listens for the fn key and, while fn is held, for right-mouse drags.
// fn + right-drag belongs to IVE, so those button events are swallowed
// (the foreground app never sees a context menu) and streamed to the
// Electron main process as newline-delimited JSON:
//
//   {"t":"ready","trusted":true}
//   {"t":"fn","down":true,"x":840,"y":420}
//   {"t":"right","down":true,"x":840,"y":420}
//   {"t":"right","drag":true,"x":902,"y":470}
//   {"t":"right","down":false,"x":902,"y":470}
//
// Build:  swiftc -O -o .build/fn-listener main.swift -framework Cocoa -framework CoreGraphics
// Requires Accessibility (to swallow events) + Input Monitoring (to observe them).

import Cocoa
import CoreGraphics

let suppress = ProcessInfo.processInfo.environment["IVE_NO_SUPPRESS"] == nil
var fnDown = false
var swallowing = false
var tap: CFMachPort?

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

func position(_ event: CGEvent) -> (Int, Int) {
    let p = event.location
    return (Int(p.x.rounded()), Int(p.y.rounded()))
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }

    if type == .flagsChanged {
        let nowFn = event.flags.contains(.maskSecondaryFn)
        if nowFn != fnDown {
            fnDown = nowFn
            let (x, y) = position(event)
            emit(["t": "fn", "down": fnDown, "x": x, "y": y])
        }
        return Unmanaged.passUnretained(event)
    }

    let (x, y) = position(event)

    if type == .rightMouseDown {
        if fnDown {
            swallowing = true
            emit(["t": "right", "down": true, "x": x, "y": y])
            return suppress ? nil : Unmanaged.passUnretained(event)
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .rightMouseDragged, swallowing {
        emit(["t": "right", "drag": true, "x": x, "y": y])
        return suppress ? nil : Unmanaged.passUnretained(event)
    }

    if type == .rightMouseUp, swallowing {
        swallowing = false
        emit(["t": "right", "down": false, "x": x, "y": y])
        return suppress ? nil : Unmanaged.passUnretained(event)
    }

    return Unmanaged.passUnretained(event)
}

// --- permissions -----------------------------------------------------------
var trusted = false
if #available(macOS 10.15, *) {
    let listenOK = CGPreflightListenEventAccess()
    if !listenOK { _ = CGRequestListenEventAccess() }
}
let promptOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
trusted = AXIsProcessTrustedWithOptions(promptOptions)
if !trusted {
    emit(["t": "permission", "accessibility": false])
}

// --- tap -------------------------------------------------------------------
let mask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
    | CGEventMask(1) << CGEventType.rightMouseDown.rawValue
    | CGEventMask(1) << CGEventType.rightMouseDragged.rawValue
    | CGEventMask(1) << CGEventType.rightMouseUp.rawValue

tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
)

guard let tap else {
    emit(["t": "permission", "accessibility": false])
    emit(["t": "ready", "trusted": false, "error": "event tap unavailable — grant Accessibility & Input Monitoring to IVE (or fn-listener), then restart IVE"])
    exit(2)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit(["t": "ready", "trusted": trusted])
CFRunLoopRun()
