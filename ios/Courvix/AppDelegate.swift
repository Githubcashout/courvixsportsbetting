import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.backgroundColor = Theme.base
        window = w
        w.makeKeyAndVisible()
        return true
    }

    // Courvix is portrait-only: the layout is built for a phone in one hand.
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .portrait
    }
}

enum Theme {
    /// Matches --base in the web app so there is no flash of a different colour.
    static let base = UIColor(red: 0x07 / 255, green: 0x0D / 255, blue: 0x18 / 255, alpha: 1)
}
