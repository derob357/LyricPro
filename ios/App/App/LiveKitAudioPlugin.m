#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LiveKitAudioPlugin, "LiveKitAudio",
           CAP_PLUGIN_METHOD(prewarm, CAPPluginReturnPromise);
)
