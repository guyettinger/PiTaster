/**
 * Screenshot service for capturing element regions.
 */

import { screen, desktopCapturer, BrowserWindow } from 'electron'
import sharp from 'sharp'
import type { ElementContext } from '@anyapp/core'

/**
 * Element info from inspector overlay.
 */
export interface ElementInfo {
  tag: string
  text: string
  classes: string[]
  id?: string
  dataAttributes: Record<string, string>
  styles: {
    position: string
    display: string
    width: string
    height: string
    backgroundColor?: string
    color?: string
  }
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  xpath: string
  selector: string
}

/**
 * Capture a region of the screen.
 */
export async function captureRegion(
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number }
): Promise<string> {
  try {
    // Get window position
    const [winX, winY] = window.getPosition()
    const windowBounds = window.getBounds()

    // Capture the entire window
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: windowBounds.width * 2, // 2x for retina
        height: windowBounds.height * 2
      }
    })

    // Find the window source
    const windowSource = sources.find((source) => source.id.includes(window.id.toString()))
    if (!windowSource) {
      throw new Error('Window source not found')
    }

    const screenshot = windowSource.thumbnail

    // Convert to buffer
    const buffer = screenshot.toPNG()

    // Account for device pixel ratio
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1

    // Crop to element region
    const cropped = await sharp(buffer)
      .extract({
        left: Math.max(0, Math.floor(bounds.x * scaleFactor)),
        top: Math.max(0, Math.floor(bounds.y * scaleFactor)),
        width: Math.max(1, Math.floor(bounds.width * scaleFactor)),
        height: Math.max(1, Math.floor(bounds.height * scaleFactor))
      })
      .resize({
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
        fit: 'contain'
      })
      .png()
      .toBuffer()

    // Return as base64 data URL
    return `data:image/png;base64,${cropped.toString('base64')}`
  } catch (err) {
    console.error('Screenshot capture failed:', err)
    throw err
  }
}

/**
 * Capture an element with screenshot.
 */
export async function captureElement(
  window: BrowserWindow,
  elementInfo: ElementInfo
): Promise<ElementContext> {
  const screenshot = await captureRegion(window, elementInfo.bounds)

  return {
    element: {
      tag: elementInfo.tag,
      text: elementInfo.text,
      classes: elementInfo.classes,
      id: elementInfo.id,
      selector: elementInfo.selector,
      xpath: elementInfo.xpath,
      bounds: elementInfo.bounds
    },
    screenshot,
    capturedAt: new Date().toISOString()
  }
}
