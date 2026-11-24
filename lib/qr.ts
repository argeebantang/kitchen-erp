import QRCode from 'qrcode'

/**
 * A QR code for `text` as a PNG data URL, for an <Image> in a react-pdf
 * document. Server-only (the route renders the PDF in Node). Knows nothing
 * about what it encodes — callers pass a link built with absoluteUrl.
 *
 * Error correction M (~15% of the code can be lost and it still reads): a
 * label on a box gets scuffed, and M keeps a ~100-character link at a size a
 * phone reads from arm's length. margin 1: the label draws its own white
 * space around it.
 */
export async function qrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 480 })
}
