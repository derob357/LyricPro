import Foundation
import Capacitor
import AVFoundation

@objc(LiveKitAudioPlugin)
public class LiveKitAudioPlugin: CAPPlugin {
    @objc func prewarm(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])
            call.resolve()
        } catch {
            call.reject("AVAudioSession activation failed: \(error.localizedDescription)")
        }
    }
}
