// rects IMG... -> one JSON line per image: {"file":..., "rects":[[x0,y0,x1,y1,conf],...]} (y from the top)
// Apple Vision VNDetectRectanglesRequest: cards, screenshots, documents laid over a video (Visual Style Builder B-roll cards, 2026-11-20)
import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("{\"file\":\"\(path)\",\"rects\":[]}"); continue }
    let req = VNDetectRectanglesRequest()
    req.minimumAspectRatio = 0.15; req.maximumAspectRatio = 1.0; req.minimumSize = 0.08
    req.maximumObservations = 12; req.quadratureTolerance = 20; req.minimumConfidence = 0.3
    let h = VNImageRequestHandler(cgImage: cg, options: [:])
    try? h.perform([req])
    var out: [String] = []
    for r in req.results ?? [] {
        let b = r.boundingBox
        out.append(String(format: "[%.3f,%.3f,%.3f,%.3f,%.2f]", b.minX, 1 - b.maxY, b.maxX, 1 - b.minY, r.confidence))
    }
    let name = (path as NSString).lastPathComponent
    print("{\"file\":\"\(name)\",\"rects\":[\(out.joined(separator: ","))]}")
}
