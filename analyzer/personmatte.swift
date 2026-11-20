// personmatte VIDEO OUTDIR TIMES.txt
// For each source time (seconds, one per line) write OUTDIR/matte_NNNNN.png: an 8-bit person matte (white = person)
// from Apple Vision VNGeneratePersonSegmentationRequest (.accurate), scaled to the video size.
import Foundation
import AVFoundation
import Vision
import CoreImage

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: personmatte VIDEO OUTDIR TIMES.txt"); exit(1) }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let outDir = args[2]
let times = try! String(contentsOfFile: args[3], encoding: .utf8).split(separator: "\n").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = .accurate
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
let ctx = CIContext()
let gray = CGColorSpaceCreateDeviceGray()
var done = 0
for (n, t) in times.enumerated() {
    autoreleasepool {
        do {
            let cg = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 6000), actualTime: nil)
            let h = VNImageRequestHandler(cgImage: cg, options: [:])
            try h.perform([req])
            guard let mask = req.results?.first?.pixelBuffer else { return }
            let ci = CIImage(cvPixelBuffer: mask)
            let sx = CGFloat(cg.width) / ci.extent.width, sy = CGFloat(cg.height) / ci.extent.height
            let scaled = ci.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
            let url = URL(fileURLWithPath: outDir + String(format: "/matte_%05d.png", n))
            try ctx.writePNGRepresentation(of: scaled, to: url, format: .L8, colorSpace: gray)
            done += 1
        } catch { print("frame \(n) t=\(t): \(error)") }
    }
}
print("wrote \(done) of \(times.count) mattes")
