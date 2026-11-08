import Capacitor
import Foundation

/// Finds computers running Tessel on the local network by browsing Bonjour for `_tessel._tcp`.
/// Emits `found` with the name, host, port and IPv4 addresses, `lost` when one goes away,
/// and `error` if iOS refuses to search (usually Local Network access turned off).
@objc(TesselDiscoveryPlugin)
public class TesselDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "TesselDiscoveryPlugin"
    public let jsName = "TesselDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var browser: NetServiceBrowser?
    private var services: [NetService] = []

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopBrowsing()
            let browser = NetServiceBrowser()
            browser.delegate = self
            browser.searchForServices(ofType: "_tessel._tcp.", inDomain: "local.")
            self.browser = browser
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopBrowsing()
            call.resolve()
        }
    }

    private func stopBrowsing() {
        browser?.stop()
        browser = nil
        services.forEach { $0.stop() }
        services.removeAll()
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 5)
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        services.removeAll { $0 == service }
        notifyListeners("lost", data: ["name": service.name])
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        notifyListeners("error", data: [
            "message": "Couldn't search the network. Turn on Local Network for Tessel in the iPhone's Settings › Privacy & Security, or type the address.",
        ])
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        let addresses = (sender.addresses ?? []).compactMap(Self.ipv4)
        notifyListeners("found", data: [
            "name": sender.name,
            "host": sender.hostName ?? "",
            "port": sender.port,
            "addresses": addresses,
        ])
    }

    /// Dotted IPv4 text from a resolved socket address, or nil for IPv6 and anything else.
    static func ipv4(_ data: Data) -> String? {
        data.withUnsafeBytes { raw -> String? in
            guard let base = raw.baseAddress, raw.count >= MemoryLayout<sockaddr_in>.size else { return nil }
            guard base.assumingMemoryBound(to: sockaddr.self).pointee.sa_family == sa_family_t(AF_INET) else { return nil }
            var address = base.assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &address, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { return nil }
            return String(cString: buffer)
        }
    }
}
