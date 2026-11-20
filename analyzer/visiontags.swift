// visiontags IMG... : Apple Vision on still images (local, free). One JSON line per image:
// {"file":..,"labels":[[name,conf]..],"faces":[{"x","y","w","h","eye_y","roll","yaw"}],"salient":[x,y,w,h]}  (normalized, y from the TOP)
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
  autoreleasepool {
    guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    let cls = VNClassifyImageRequest()
    let face = VNDetectFaceLandmarksRequest()
    let sal = VNGenerateAttentionBasedSaliencyImageRequest()
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([cls, face, sal])
    var labels: [[Any]] = []
    for o in (cls.results ?? []).filter({ $0.confidence > 0.08 }).prefix(12) { labels.append([o.identifier, Double(o.confidence)]) }
    var faces: [[String: Any]] = []
    for f in face.results ?? [] {
      let b = f.boundingBox
      var eye = 1 - (b.minY + b.height * 0.62)
      if let le = f.landmarks?.leftEye?.normalizedPoints, let re = f.landmarks?.rightEye?.normalizedPoints, !le.isEmpty, !re.isEmpty {
        let ys = (le + re).map { $0.y }
        let my = ys.reduce(0, +) / CGFloat(ys.count)
        eye = 1 - (b.minY + my * b.height)
      }
      faces.append(["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "eye_y": eye,
                    "roll": f.roll?.doubleValue ?? 0, "yaw": f.yaw?.doubleValue ?? 0])
    }
    var salient: [Double] = []
    if let o = sal.results?.first, let s = o.salientObjects?.first {
      let b = s.boundingBox
      salient = [b.minX, 1 - b.maxY, b.width, b.height]
    }
    let line: [String: Any] = ["file": (path as NSString).lastPathComponent, "labels": labels, "faces": faces, "salient": salient]
    if let d = try? JSONSerialization.data(withJSONObject: line) { print(String(data: d, encoding: .utf8)!) }
  }
}
