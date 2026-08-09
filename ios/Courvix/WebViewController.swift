import UIKit
import WebKit

/// Hosts the bundled Courvix web app.
///
/// The page is served through a custom `courvix://` URL scheme rather than
/// `file://`. That matters: a file:// page has a null origin, so every fetch to
/// statsapi.mlb.com or site.api.espn.com would be a cross-origin request from a
/// null origin and get blocked regardless of the server's CORS headers. A custom
/// scheme gives the page a real origin, so the permissive `Access-Control-Allow-Origin`
/// those APIs send is actually honoured.
final class WebViewController: UIViewController {

    private var webView: WKWebView!
    private static let scheme = "courvix"
    private static let host = "app"

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: WebViewController.scheme)
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()          // keep localStorage between launches

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.isOpaque = false
        wv.backgroundColor = Theme.base
        wv.scrollView.backgroundColor = Theme.base
        wv.scrollView.bounces = false                 // no rubber-banding; this is an app, not a page
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.allowsBackForwardNavigationGestures = false
        wv.navigationDelegate = self
        if #available(iOS 16.4, *) { wv.isInspectable = true }   // Safari Web Inspector over USB
        webView = wv
        view = wv
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.base
        var comps = URLComponents()
        comps.scheme = WebViewController.scheme
        comps.host = WebViewController.host
        comps.path = "/index.html"
        if let url = comps.url {
            webView.load(URLRequest(url: url))
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { false }
}

extension WebViewController: WKNavigationDelegate {
    /// Keep in-app navigation to our own scheme; hand real links to Safari.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if url.scheme == WebViewController.scheme { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated,
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadFailure(error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadFailure(error)
    }

    private func showLoadFailure(_ error: Error) {
        // The bundle is local, so this should be unreachable — but a blank screen
        // with no explanation is the worst possible failure mode.
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(white: 0.7, alpha: 1)
        label.font = .systemFont(ofSize: 14)
        label.text = "Courvix failed to load its bundle.\n\n\(error.localizedDescription)"
        label.frame = view.bounds.insetBy(dx: 28, dy: 0)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(label)
    }
}

/// Serves files out of the app bundle over the custom scheme.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js":   "text/javascript; charset=utf-8",
        "css":  "text/css; charset=utf-8",
        "json": "application/json",
        "svg":  "image/svg+xml",
        "png":  "image/png",
        "ico":  "image/x-icon"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(Err.badURL); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        // Refuse anything that tries to climb out of the bundle.
        let name = (path as NSString).lastPathComponent
        guard !name.isEmpty, !path.contains("..") else {
            urlSchemeTask.didFailWithError(Err.forbidden); return
        }

        let ext = (name as NSString).pathExtension.lowercased()
        let base = (name as NSString).deletingPathExtension
        guard let fileURL = Bundle.main.url(forResource: base, withExtension: ext, subdirectory: "web")
                        ?? Bundle.main.url(forResource: base, withExtension: ext),
              let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(Err.notFound(path)); return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": BundleSchemeHandler.types[ext] ?? "application/octet-stream",
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache"
            ])!

        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { }

    enum Err: LocalizedError {
        case badURL, forbidden, notFound(String)
        var errorDescription: String? {
            switch self {
            case .badURL: return "Malformed request URL"
            case .forbidden: return "Path not permitted"
            case .notFound(let p): return "Not found in bundle: \(p)"
            }
        }
    }
}
