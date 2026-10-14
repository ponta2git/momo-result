import AppKit
let width = 1920, height = 1080
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.white.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
func text(_ value: String, _ x: CGFloat, _ top: CGFloat, _ size: CGFloat) {
 let attrs: [NSAttributedString.Key: Any] = [.font: NSFont(name: "HiraginoSans-W6", size: size)!, .foregroundColor: NSColor.black]
 (value as NSString).draw(at: NSPoint(x: x, y: CGFloat(height)-top-size*1.4), withAttributes: attrs)
}
let names = ["ぽんた社長", "オータカ社長", "いーゆー社長", "さくま社長"]
let amounts = ["400万円", "300万円", "200万円", "100万円"]
let ys: [CGFloat] = [200, 395, 585, 775]
for i in 0..<4 { text(names[i] + "   " + amounts[i], 160, ys[i]+45, 62) }
let xs: [CGFloat] = [114, 548, 981, 1414]
let colors = [NSColor.blue, NSColor.red, NSColor.yellow, NSColor.green]
for i in 0..<4 {
 colors[i].setFill(); NSRect(x: xs[i], y: 20, width: 410, height: 90).fill()
 NSColor.white.setFill(); NSRect(x: xs[i]+12, y: 30, width: 386, height: 70).fill()
 text(names[i], xs[i]+24, 985, 36)
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
