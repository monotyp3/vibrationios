import Foundation
import UIKit
import AudioToolbox
import CoreHaptics
import Capacitor

// Small native plugin that gives true press-and-hold haptics.
//
// Why this exists: @capacitor/haptics only has vibrate(duration), which needs
// to know how long to buzz before it starts. When mirroring a live finger we
// do not know that yet, so we need start() on finger down and stop() on
// finger up. This plugin keeps one Core Haptics engine warm so start() fires
// with almost no delay.

@objc(HapticTouchPlugin)
public class HapticTouchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticTouchPlugin"
    public let jsName = "HapticTouch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise)
    ]

    private let supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private let queue = DispatchQueue(label: "haptic.touch", qos: .userInteractive)
    private var engine: CHHapticEngine?
    private var engineRunning = false
    private var player: CHHapticAdvancedPatternPlayer?

    override public func load() {
        queue.async { self.makeEngine() }
    }

    // MARK: Engine

    private func makeEngine() {
        guard supportsHaptics else { return }
        do {
            let newEngine = try CHHapticEngine()
            newEngine.playsHapticsOnly = true
            newEngine.isAutoShutdownEnabled = false
            newEngine.stoppedHandler = { [weak self] _ in
                self?.queue.async {
                    self?.engineRunning = false
                    self?.player = nil
                }
            }
            newEngine.resetHandler = { [weak self] in
                self?.queue.async {
                    self?.engineRunning = false
                    self?.player = nil
                    _ = self?.readyEngine()
                }
            }
            engine = newEngine
            _ = readyEngine()
        } catch {
            engine = nil
        }
    }

    // Returns a running engine, starting it if iOS stopped it (app went to background, etc).
    private func readyEngine() -> CHHapticEngine? {
        if engine == nil { makeEngine() }
        guard let engine = engine else { return nil }
        if !engineRunning {
            do {
                try engine.start()
                engineRunning = true
            } catch {
                return nil
            }
        }
        return engine
    }

    // MARK: JS methods

    // Begin a continuous vibration. Keeps going until stop() (30 s safety cap).
    @objc public func start(_ call: CAPPluginCall) {
        let intensity = Float(call.getDouble("intensity", 1.0))
        let sharpness = Float(call.getDouble("sharpness", 0.5))
        queue.async {
            self.stopPlayer()
            guard let engine = self.readyEngine() else {
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                return
            }
            do {
                let event = CHHapticEvent(
                    eventType: .hapticContinuous,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
                    ],
                    relativeTime: 0,
                    duration: 30
                )
                let pattern = try CHHapticPattern(events: [event], parameters: [])
                let newPlayer = try engine.makeAdvancedPlayer(with: pattern)
                try newPlayer.start(atTime: CHHapticTimeImmediate)
                self.player = newPlayer
            } catch {
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            }
        }
        call.resolve()
    }

    // End the current vibration right away.
    @objc public func stop(_ call: CAPPluginCall) {
        queue.async { self.stopPlayer() }
        call.resolve()
    }

    // One short, crisp tick (used for UI feedback).
    @objc public func tap(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
        call.resolve()
    }

    // Stop the screen from auto-locking while the app is open.
    @objc public func keepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled", true)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
        }
        call.resolve()
    }

    @objc public func isSupported(_ call: CAPPluginCall) {
        call.resolve(["haptics": supportsHaptics])
    }

    private func stopPlayer() {
        if let current = player {
            try? current.stop(atTime: CHHapticTimeImmediate)
            player = nil
        }
    }
}
