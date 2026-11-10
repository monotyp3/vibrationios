// swift-tools-version: 5.9
import PackageDescription

// Local Capacitor plugin. The Capacitor CLI links it automatically during
// `npx cap sync ios` because it is listed in the app's package.json.
let package = Package(
    name: "HapticTouch",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "HapticTouch",
            targets: ["HapticTouchPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "HapticTouchPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/HapticTouchPlugin")
    ]
)
