// textboxes VIDEO FPS OUT.jsonl
// Apple Vision text recognition on frames sampled at FPS. One JSON line per sample:
// {"t":sec,"boxes":[{"x":..,"y":..,"w":..,"h":..,"text":"..","conf":..}]}  (x,y,w,h normalized, y from the TOP)
import Foundation
import AVFoundation
import Vision

let a = CommandLine.arguments
guard a.count >= 4 else { print("usage: textboxes VIDEO FPS OUT.jsonl"); exit(1) }
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let fps = Double(a[2])!
let dur = CMTimeGetSeconds(asset.duration)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: 720, height: 1280)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
FileManager.default.createFile(atPath: a[3], contents: nil)
let fh = FileHandle(forWritingAtPath: a[3])!
var t = 0.0
while t < dur {
    autoreleasepool {
        if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 6000), actualTime: nil) {
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = false
            try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
            var boxes: [[String: Any]] = []
            for o in req.results ?? [] {
                guard let c = o.topCandidates(1).first else { continue }
                let b = o.boundingBox
                boxes.append(["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "text": c.string, "conf": c.confidence])
            }
            let line: [String: Any] = ["t": t, "boxes": boxes]
            let d = try! JSONSerialization.data(withJSONObject: line)
            fh.write(d); fh.write("\n".data(using: .utf8)!)
        }
    }
    t += 1.0 / fps
}
fh.closeFile()
