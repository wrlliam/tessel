import Capacitor

/// The app's web view controller. Registers plugins that live in this app rather than in a package.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TesselDiscoveryPlugin())
    }
}
