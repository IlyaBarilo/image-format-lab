import * as config from './core/config.mjs';
import { createState, collectElements } from './state.mjs';
import * as utils from './core/utils.mjs';
import * as gif from './core/gif.mjs';
import * as bmp from './core/bmp.mjs';
import * as metrics from './core/metrics.mjs';
import * as metadata from './core/metadata.mjs';
import * as settings from './core/settings.mjs';
import * as zip from './core/zip.mjs';
import * as pixels from './core/pixels.mjs';
import * as passport from './core/file-passport.mjs';
import { createBootstrap } from './ui/bootstrap.mjs';
import { createTheme } from './ui/theme.mjs';
import { createPreferences } from './ui/preferences.mjs';
import { createFiles } from './ui/files.mjs';
import { createFileDrop } from './ui/file-drop.mjs';
import { createBatchSettings } from './ui/batch-settings.mjs';
import { createBatchDialog } from './ui/batch-dialog.mjs';
import { createBatchPreview } from './ui/batch-preview.mjs';
import { createBatchRun } from './ui/batch-run.mjs';
import { createDownloads } from './ui/downloads.mjs';
import { createFormatSettings } from './ui/format-settings.mjs';
import { createControls } from './ui/controls.mjs';
import { createComparison } from './ui/comparison.mjs';
import { createSource } from './ui/source.mjs';
import { createCanvas } from './ui/canvas.mjs';
import { createStudy } from './ui/study.mjs';
import { createQualitySeries } from './ui/quality-series.mjs';
import { createLicenses } from './ui/licenses.mjs';
import { createReports } from './ui/reports.mjs';
import { createAnalysis } from './ui/analysis.mjs';
import { createPixelInspector } from './ui/pixel-inspector.mjs';
import { createFilePassport } from './ui/file-passport.mjs';
import { createAnalysisLayout } from './ui/analysis-layout.mjs';
import { createAnalysisRegion } from './ui/analysis-region.mjs';
import { createScopePlots } from './ui/scope-plots.mjs';
import { createAnalysisCombined } from './ui/analysis-combined.mjs';
import { createAnalysisOutput } from './ui/analysis-output.mjs';
import { createStatus } from './ui/status.mjs';
import { createCodecs } from './services/codecs.mjs';
import { createModern } from './services/modern.mjs';
import { createHeic } from './services/heic.mjs';
import { createTiff } from './services/tiff.mjs';
import { createSupport } from './services/support.mjs';
import { createDecode } from './services/decode.mjs';
import { createPng } from './services/png.mjs';
import { createEncode } from './services/encode.mjs';
import { createCompute } from './services/compute.mjs';

// One composition root; feature modules do not import one another.
export function createApplication() {
  const app = createState(), els = collectElements();
  const context = { app, els };
  const actions = Object.assign({}, utils, gif, bmp, metrics, metadata, settings, zip, pixels, passport);
  function dependencies(names) {
    return Object.defineProperties({}, Object.fromEntries(names.map(name => [name, { get: () => actions[name] }])));
  }
  Object.assign(actions, createBootstrap(context, dependencies([
    "attachThemeEvents",
    "restoreUserPreferences",
    "attachUserPreferenceEvents",
    "attachAnalysisEvents",
    "attachPixelInspectorEvents",
    "attachLicenseEvents",
    "addFiles",
    "attachBatchPreviewEvents",
    "attachCanvasEvents",
    "attachWipeEvents",
    "attachEvents",
    "attachFileDropEvents",
    "attachStudyEvents",
    "buildCellControls",
    "buildMetrics",
    "cancelBatch",
    "clamp",
    "clearBatchPreview",
    "clearFiles",
    "commitBatchDialog",
    "createSampleFile",
    "detectEncoderSupport",
    "drawAll",
    "loadAdditionalCodecs",
    "markDirty",
    "observeCanvasSizes",
    "openBatchDialog",
    "renderVisibleVariants",
    "resetView",
    "resizeCanvases",
    "restoreBatchSettings",
    "selectAdjacentFile",
    "selectFile",
    "setWipeMode",
    "showStatus",
    "updateBatchDialog",
    "updateBatchUI",
    "updateCodecStatus",
    "updateFileList",
    "updateLayout"
  ])));
  Object.assign(actions, createFormatSettings());
  Object.assign(actions, createTheme());
  Object.assign(actions, createPreferences(context, dependencies([
    "captureComparison", "applyComparison", "captureAnalysisLayoutPreferences", "applyAnalysisLayoutPreferences",
    "captureAnalysisOutputPreferences", "applyAnalysisOutputPreferences", "captureAnalysisRegionPreferences", "applyAnalysisRegionPreferences",
    "isAnalysisResizing", "resetTheme", "showStatus", "updateBatchUI", "updateAnalysis", "drawAll", "syncGridModeUI"
  ])));
  Object.assign(actions, createLicenses(context, dependencies(["downloadBlob"])));
  Object.assign(actions, createFileDrop(context, dependencies(["addFiles"])));
  Object.assign(actions, createFiles(context, dependencies([
    "batchStatusLabel",
    "clearFiles",
    "disposeSource",
    "drawAll",
    "formatBytes",
    "isImageCandidate",
    "loadFile",
    "removeFile",
    "resetView",
    "selectFile",
    "setEmptyState",
    "showStatus",
    "updateBatchUI",
    "updateFileList"
  ])));
  Object.assign(actions, createBatchSettings(context, dependencies([
    "formatUnavailableReason",
    "normalizeBatchSettings"
  ])));
  Object.assign(actions, createBatchDialog(context, dependencies([
    "openTiffSettings",
    "batchDialogError",
    "batchFilesLabel",
    "clearBatchPreview",
    "convertAllFiles",
    "exportConfigDescription",
    "formatUnavailableReason",
    "persistBatchSettings",
    "readBatchDialogConfig",
    "requestBatchPreview",
    "selectedBatchFiles",
    "uniqueOutputName",
    "updateBatchDialog",
    "updateBatchDialogFormats",
    "updateBatchUI",
    "validateExportConfig"
  ])));
  Object.assign(actions, createBatchPreview(context, dependencies([
    "clamp",
    "clearBatchPreview",
    "decodeVariantForPreview",
    "downloadBlob",
    "drawBackground",
    "drawBatchPreview",
    "drawImageFrame",
    "encodeFromSource",
    "formatBytes",
    "isBatchPreviewReady",
    "measurePixels",
    "readBatchDialogConfig",
    "renderBatchPreview",
    "uniqueOutputName",
    "validateExportConfig"
  ])));
  Object.assign(actions, createBatchRun(context, dependencies([
    "batchStatusLabel",
    "convertAllFiles",
    "createStoredZip",
    "decodeSourceFile",
    "decodeVariantForPreview",
    "downloadBlob",
    "encodeFromSource",
    "exportConfigDescription",
    "formatBytes",
    "selectedBatchFiles",
    "showStatus",
    "uniqueOutputName",
    "updateBatchDialog",
    "updateBatchReport",
    "updateBatchUI",
    "updateFileList",
    "validateExportConfig"
  ])));
  Object.assign(actions, createDownloads(context, dependencies([
    "triggerDownload"
  ])));
  Object.assign(actions, createControls(context, dependencies([
    "updateAnalysis",
    "updatePixelInspector",
    "openFilePassport", "updateFilePassport",
    "clamp",
    "codecLabel",
    "detectAlpha",
    "downloadVariant",
    "drawAll",
    "formatUnavailableReason",
    "isVariantReady",
    "markDirty",
    "outputFormatLabel",
    "renderVariant",
    "resizeCanvases",
    "syncControlsVisibility",
    "updateBatchDialog",
    "updateBatchDialogFormats",
    "updateMetrics"
  ])));
  Object.assign(actions, createComparison(context, dependencies([
    "alphaLabel",
    "decodeVariantForPreview",
    "disposeVariantOutput",
    "drawAll",
    "encodeFromSource",
    "formatBytes",
    "formatUnavailableReason",
    "imageDataToPreview",
    "isVariantReady",
    "measurePixels",
    "outputFormatLabel",
    "renderVariant",
    "showStatus",
    "sourceFileExtension",
    "sourceOriginalFormatLabel",
    "updateMetrics"
  ])));
  Object.assign(actions, createSource(context, dependencies([
    "updateAnalysis",
    "clearBatchPreview",
    "decodeSourceFile",
    "disposeSource",
    "disposeVariantOutput",
    "drawAll",
    "formatBytes",
    "renderVisibleVariants",
    "resetView",
    "roundRect",
    "setEmptyState",
    "showStatus",
    "updateMetrics"
  ])));
  Object.assign(actions, createCanvas(context, dependencies([
    "attachCanvasEvents",
    "getAnalysisScope", "getAnalysisRegion", "getAnalysisLine",
    "updateFilePassport",
    "updatePixelInspector", "drawPixelMarker", "pixelPointerDown", "pixelPointerMove", "pixelPointerUp", "cancelPixelPointer",
    "isAnalysisResizing",
    "isVariantReady",
    "updateAnalysisViewport",
    "updateAnalysis",
    "clamp",
    "comparisonScale",
    "drawAll",
    "drawBackground",
    "drawImageFrame",
    "drawOverlayMessage",
    "drawVariant",
    "endPointer",
    "getDrawScale",
    "renderVisibleVariants",
    "resizeCanvases",
    "roundRect",
    "syncCellHeadSizes",
    "updateLayout"
  ])));
  Object.assign(actions, createStudy(context, dependencies([
    "addFiles",
    "applyComparison",
    "attachQualitySeriesEvents",
    "buildCellControls",
    "buildMetrics",
    "captureComparison",
    "comparisonScale",
    "disposeVariantOutput",
    "downloadBlob",
    "encodeExactPng",
    "drawAll",
    "formatUnavailableReason",
    "markDirty",
    "parseProfiles",
    "resetView",
    "retryBatchErrors",
    "saveComparisonReport",
    "saveExperimentProtocol",
    "saveProfiles",
    "setBatchSelection",
    "setComparisonScale",
    "setWipeMode",
    "studyNotice",
    "updateFormatHelp",
    "updateFormatOptions",
    "updateLayout",
    "updateProfiles",
    "validateComparison"
  ])));
  Object.assign(actions, createQualitySeries(context, dependencies([
    "decodeVariantForPreview",
    "downloadBlob",
    "encodeFromSource",
    "formatUnavailableReason",
    "measurePixels"
  ])));
  Object.assign(actions, createReports(context, dependencies([
    "captureComparison",
    "codecLabel",
    "comparisonReport",
    "csvCell",
    "downloadBlob",
    "getAnalysisSnapshot",
    "isVariantReady"
  ])));
  Object.assign(actions, createAnalysisRegion(context, dependencies(["updateAnalysis", "getAnalysisViewport", "isAnalysisResizing", "encodeExactPng", "registerExactPngFile", "addFiles", "showStatus"])));
  Object.assign(actions, createPixelInspector(context, dependencies(["isVariantReady", "outputFormatLabel", "getDrawScale", "redrawPreviews", "redrawAnalysis"])));
  Object.assign(actions, createFilePassport(context, dependencies(["inspectFile", "workingRasterInfo", "fileBitsPerPixel", "formatBytes", "isVariantReady", "outputFormatLabel"])));
  Object.assign(actions, createScopePlots());
  Object.assign(actions, createAnalysisCombined());
  Object.assign(actions, createAnalysisOutput(context, dependencies(["getAnalysisSnapshot", "redrawAnalysis", "downloadBlob", "renderAnalysisChart", "renderAnalysisOverlay", "renderAnalysisDelta", "renderAnalysisTradeoff", "isAnalysisResizing"])));
  Object.assign(actions, createAnalysisLayout(context, dependencies(["drawAll", "redrawAnalysis", "drawAnalysisRegion", "expandAnalysis", "collapseAnalysis", "pauseAnalysisForResize", "resumeAnalysisAfterResize"])));
  Object.assign(actions, createAnalysis(context, dependencies(["isVariantReady", "outputFormatLabel", "workerCompute", "drawAll", "redrawPreviews", "getAnalysisScope", "getAnalysisViewport", "getAnalysisRegion", "getAnalysisLine", "syncAnalysisRegion", "closeAnalysisRegion", "toggleAnalysisLine", "drawAnalysisRegion", "attachAnalysisRegionEvents", "plotVectorscope", "plotLineProfile", "plotErrorProfile", "plotSSIM", "getAnalysisOutputSettings", "syncAnalysisOutput", "presentAnalysis", "attachAnalysisOutputEvents", "attachAnalysisLayoutEvents", "syncAnalysisLayout", "restoreAnalysisLayout"])));
  Object.assign(actions, createStatus(context, dependencies([

  ])));
  Object.assign(actions, createHeic());
  Object.assign(actions, createModern());
  Object.assign(actions, createTiff());
  Object.assign(actions, createCodecs(context, dependencies([
    "loadHeicCodec",
    "loadModernCodec",
    "loadTiffCodec",
    "loadOptionalCodec",
    "loadScript",
    "updateCodecStatus",
    "updateFormatOptions",
  ])));
  Object.assign(actions, createSupport(context, dependencies([
    "canDataUrlEncode",
    "canWorkerEncode",
    "drawAll",
    "updateFormatOptions"
  ])));
  Object.assign(actions, createPng(context, dependencies(["loadScript"])));
  Object.assign(actions, createDecode(context, dependencies([
    "decodePngFile",
    "decodeHeicFile",
    "decodeImageBlob",
    "decodeImageBlobOrOptional",
    "decodeTiffFile",
    "detectAlpha",
    "fileKind",
    "imageDataToPreview",
    "loadOptionalCodec",
    "readPanoramaMetadata",
    "showStatus"
  ])));
  Object.assign(actions, createEncode(context, dependencies([
    "encodeExactPng",
    "encodePalettePng",
    "canvasToBlobStrict",
    "clamp",
    "cloneImageData",
    "computeImage",
    "detectAlpha",
    "embedJpegPanorama",
    "encodeGifenc",
    "encodeOne",
    "encodePngUpng",
    "loadOptionalCodec",
    "outputDimensionsForConfig",
    "outputSourceForConfig",
    "prepareCanvasForFormat",
    "quantizeUniform",
    "scaledPanorama",
    "staleRequest",
    "validateExportConfig",
    "withEncodedMeta"
  ])));
  Object.assign(actions, createCompute(context, dependencies([
    "computePixelMetrics",
    "prepareMetricInputs",
    "encodeBmp",
    "encodeBmp8",
    "encodeGif",
    "showStatus",
    "workerCompute"
  ])));
  return { app, els, actions, config };
}
