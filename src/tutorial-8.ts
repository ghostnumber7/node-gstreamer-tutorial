// translation of https://gstreamer.freedesktop.org/documentation/tutorials/basic/short-cutting-the-pipeline.html

/// <reference path="@types/node-gtk/Gst-1.0.d.ts" />
/// <reference path="@types/node-gtk/GstAudio-1.0.d.ts" />
/// <reference path="@types/node-gtk/GLib-2.0.d.ts" />

const gi = require('node-gtk')
const Gst = gi.require('Gst', '1.0')
const GstAudio = gi.require('GstAudio', '1.0')
const GLib = gi.require('GLib', '2.0')
gi.startLoop()

// Initialize GStreamer
Gst.init()

// global constants
const CHUNK_SIZE = 1024
const SAMPLE_RATE = 44100

let sourceId = 0
let numSamples = 0
let data = {
  appsrc: undefined,
  a: 0, b: 0,
  c: 0, d: 0,
}

function pushData() {
  const buffer = Gst.Buffer.newAllocate(null, CHUNK_SIZE)
  buffer.dts = Gst.utilUint64Scale(numSamples, Gst.SECOND, SAMPLE_RATE)
  buffer.duration = Gst.utilUint64Scale(CHUNK_SIZE / 2, Gst.SECOND, SAMPLE_RATE)

  const [_, map] = buffer.map(Gst.MapFlags.WRITE)
  data.c += data.d
  data.d -= data.c / 1000
  const freq = 1100 + 1000 * data.d
  for (let i = 0; i < CHUNK_SIZE / 2; ++i) {
    data.a += data.b
    data.b -= data.a / freq
    // TODO: write data
  }
  buffer.unmap(map)
  // Push the buffer into the appsrc
  console.log('Pushing?')
  const ret = data.appsrc.emitByName('push-buffer', buffer)

  // Free the buffer now that we are done with it
  // buffer.unref()
  if (ret !== Gst.FlowReturn.OK) {
    // We got some error, stop sending data
    return false
  }
  return true
}

function main() {
  // Create the elements
  const appsrc = data.appsrc = Gst.ElementFactory.make('appsrc')
  const tee = Gst.ElementFactory.make('tee')
  const aqueue = Gst.ElementFactory.make('queue', 'audio_queue')
  const aconvert1 = Gst.ElementFactory.make('audioconvert')
  const aresample = Gst.ElementFactory.make('audioresample')
  const asink = Gst.ElementFactory.make('autoaudiosink')
  const vqueue = Gst.ElementFactory.make('queue', 'video_queue')
  const aconvert2 = Gst.ElementFactory.make('audioconvert')
  const visual = Gst.ElementFactory.make('wavescope', 'visual')
  const vconvert = Gst.ElementFactory.make('videoconvert')
  const vsink = Gst.ElementFactory.make('autovideosink')
  const appqueue = Gst.ElementFactory.make('queue')
  const appsink = Gst.ElementFactory.make('appsink')

  // Create the empty pipeline
  const pipeline = new Gst.Pipeline()

  if (!appsrc || !tee || !aqueue || !aconvert1 || !aresample || !asink || !vqueue || !aconvert2 || !visual || !vconvert || !vsink || !appqueue || !appsink || !pipeline) {
    console.error('Not all elements could be created.')
    return
  }

  // Configure wavescope
  // TODO: use non-internal setters?
  gi._c.ObjectPropertySetter(visual, 'shader', 0)
  gi._c.ObjectPropertySetter(visual, 'style', 1)

  // Configure appsrc
  const audioInfo = new GstAudio.AudioInfo()
  audioInfo.setFormat(GstAudio.AudioFormat.S16, SAMPLE_RATE, 1)
  const audioCaps = audioInfo.toCaps()
  gi._c.ObjectPropertySetter(appsrc, 'caps', audioCaps)
  gi._c.ObjectPropertySetter(appsrc, 'format', Gst.Format.TIME)
  appsrc.on('need-data', size => {
    if (sourceId === 0) {
      console.log('Start feeding.')
      GLib.idleAdd(GLib.PRIORITY_DEFAULT_IDLE, pushData)
    }
  })
  appsrc.on('enough-data', () => {
    if (sourceId !== 0) {
      console.log('Stop feeding.')
      GLib.Source.remove(sourceId)
      sourceId = 0
    }
  })
  
  // Configure appsink
  gi._c.ObjectPropertySetter(appsink, 'emit-signals', true)
  gi._c.ObjectPropertySetter(appsink, 'caps', audioCaps)
  appsink.on('new-sample', () => {

  })
  // audioCaps.unref()

  pipeline.add(appsrc)
  pipeline.add(tee)
  pipeline.add(aqueue)
  pipeline.add(aconvert1)
  pipeline.add(aresample)
  pipeline.add(asink)
  pipeline.add(vqueue)
  pipeline.add(aconvert2)
  pipeline.add(visual)
  pipeline.add(vconvert)
  pipeline.add(vsink)
  pipeline.add(appqueue)
  pipeline.add(appsink)


  // Link all elements that can be automatically linked because they have "Always" pads
  const isLinked = (
    appsrc.link(tee)
  ) && (
    aqueue.link(aconvert1) && aconvert1.link(aresample) && aresample.link(asink)
  ) && (
    vqueue.link(aconvert2) && aconvert2.link(visual) && visual.link(vconvert) && vconvert.link(vsink)
  ) && (
    appqueue.link(appsink)
  )
  if (!isLinked) {
    console.error('Elements could not be linked.')
    pipeline.unref()
    return
  }

  // Manually link the Tee, which has "Request" pads
  const teeAudioPad = tee.getRequestPad('src_%u')
  console.log(`Obtained request pad ${teeAudioPad.getName()} for audio branch.`)
  const queueAudioPad = aqueue.getStaticPad('sink')

  const teeVideoPad = tee.getRequestPad('src_%u')
  console.log(`Obtained request pad ${teeVideoPad.getName()} for video branch.`)
  const queueVideoPad = vqueue.getStaticPad('sink')

  const teeAppPad = tee.getRequestPad('src_%u')
  console.log(`Obtained request pad ${teeAppPad.getName()} for app branch.`)
  const queueAppPad = appqueue.getStaticPad('sink')

  const padsLinked = (
    teeAudioPad.link(queueAudioPad) === Gst.PadLinkReturn.OK &&
    teeVideoPad.link(queueVideoPad) === Gst.PadLinkReturn.OK &&
    teeAppPad.link(queueAppPad) === Gst.PadLinkReturn.OK
  )
  if (!padsLinked) {
    console.error('Tee could not be linked.')
    pipeline.unref()
    return
  }
  queueAudioPad.unref()
  queueVideoPad.unref()
  teeAppPad.unref()

  // Instruct the bus to emit signals for each received message, and connect to the interesting signals
  const bus = pipeline.getBus()
  bus.addSignalWatch()
  bus.on('message::error', msg => {
    // const [err, debugInfo] = msg.parseError()
    console.error('Got error')
    // mainLoop.quit()
  })
  bus.unref()

  // Start playing the pipeline
  pipeline.setState(Gst.State.PLAYING)

  // Create a GLib Main Loop and set it to run
  const mainLoop = new GLib.MainLoop(null, false)
  mainLoop.run()
  // TODO: do not block the main loop - workaround: setInterval?
  // setInterval(() => {}, 1000)
  // return

  // Release the request pads from the Tee, and unref them
  tee.releaseRequestPad(teeAudioPad)
  tee.releaseRequestPad(teeVideoPad)
  tee.releaseRequestPad(teeAppPad)
  teeAudioPad.unref()
  teeVideoPad.unref()
  teeAppPad.unref()

  // Free resources
  pipeline.setState(Gst.State.NULL)
  pipeline.unref()
}

main()
