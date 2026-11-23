// Xcode normally links the Foundation extension entry point for an appex.
@_silgen_name("NSExtensionMain")
private func startExtension(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32

@main
struct ExtensionMain {
    static func main() {
        _ = startExtension(CommandLine.argc, CommandLine.unsafeArgv)
    }
}
