/* Global variables and objects */

// Variational Autoencoder stuff
let encoderModel = undefined;
let decoderModel = undefined;

// Audio stuff
var audio_manager = new AudioManager();
var MONO_MODE = true;
let model
let sampleValuesInLatentSpace

// Sounds and content
var default_query = "footstep"
var default_audio_query = "files/audioPrueba.json"
var default_audio = []
var default_query_model = "files/model/model.json"
var sounds = [];
var extra_descriptors = undefined;
var map_features = undefined;
var map_type = "tsne"
var n_pages = 3;
var n_pages_received = 0;
var all_loaded = false;
var last_selected_sound_id = undefined;

// t-sne and xy map
var max_tsne_iterations = 500;
var current_it_number = 0;
var epsilon = 10;
var perplexity = 10;
var tsne = undefined;
var max_xy_iterations = 50;
var map_xy_x_max = undefined;
var map_xy_x_min = undefined;
var map_xy_y_max = undefined;
var map_xy_y_min = undefined;

// Canvas and display stuff
var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
var w = window.innerWidth;
var h = window.innerHeight;
var default_point_modulation = 0.6;
var disp_scale = Math.min(w, h);
var center_x = undefined;  // Set in start()
var center_y = undefined;  // Set in start()
var zoom_factor = undefined;  // Set in start()
var rotation_degrees = undefined;  // Set in start()
var min_zoom = 0.2;
var max_zoom = 15;
const PI = Math.PI
const PI2 = 2 * Math.PI

/* Setup and app flow functions */

async function getModels() {
    const uploadJSONInput = document.getElementById('upload-json');
    const uploadWeightsInput = document.getElementById('upload-weights');
    const model = await tf.loadLayersModel(tf.io.browserFiles(
        [uploadJSONInput.files[0], uploadWeightsInput.files[0]]));
}

function sampleFromLatentSpace(mu, log_variance) {
    let epsilon = jStat.normal.sample(0, 1);
    return mu + Math.exp(log_variance / 2) * epsilon;
}

function windowCosineMateo(bufferSize, type = "hamming") {
    windowValues = []
    for (let i = 0; i < bufferSize; i++) {
        windowValues[i] = Math.sin(Math.PI / 1024 * (i + 0.5));
    }
    return windowValues;
}

function centerPad(data, framelength) {
    let zerosArray = Array(framelength / 2).fill(0);
    return zerosArray.concat(data).concat(zerosArray)
}

function zeroPad(data, framelength) {
    while (data.length % framelength !== 0) {
        data.push(0);
    }
    return data;
}

function processSpectrogram(signalChunk, framelength) {
    let data = math.dotMultiply(signalChunk, windowCosineMateo(framelength));
    return mclt(data);
}

function spectrogramMateo(data, framelength = 1024, centered = true) {
    let outlength = data.length;
    let overlap = 2;
    let hopsize = framelength / overlap;
    let signal = data;

    if (centered) {
        signal = centerPad(signal, framelength);
    }
    signal = zeroPad(signal, framelength);

    let values = [];
    let chunksSize = signal.length / hopsize - 1;
    for (let chunk = 0; chunk < chunksSize; chunk++) {
        values.push(processSpectrogram(signal.slice(chunk * hopsize, (chunk * hopsize) + framelength), framelength));
    }

    return values;
}

// alv = []
// for (let i=0; i<512; i++) {
//     alv[i] = [];
//     for (let j=0; j<64; j++) {
//         alv[i].push(j*i)
//     }}

function ispectrogramMateo(data, framelength = 1024, centered = true) {
    let overlap = 2;
    let hopsize = framelength / overlap;
    let spectrogram = data;

    let values = [];
    let chunksSize = spectrogram.length;
    for (let chunk = 0; chunk < chunksSize; chunk++) {
        values.push(math.dotMultiply(imclt(spectrogram[chunk]), windowCosineMateo(framelength)));
    }

    result = []
    for (let i = 0; i < values.length; i++) {
        if (i == 0) {
            result = result.concat(values[i].slice(0, values[i].length / 2));
            result = result.concat(math.add(values[i].slice(values[i].length / 2, values[i].length), values[i + 1].slice(0, values[i + 1].length / 2)));
        } else if (i == values.length - 1) {
            result = result.concat(values[i].slice(values[i].length / 2, values[i].length));
        } else {
            result = result.concat(math.add(values[i].slice(values[i].length / 2, values[i].length), values[i + 1].slice(0, values[i + 1].length / 2)));
        }
    }

    return result;
}

function mclt(x, odd = true) {
    let N = Math.floor(x.length / 2);
    let N2 = N * 2;
    let n0 = (N + 1) / 2;
    let pre_twiddle = [];
    let offset = 0;
    let outlen = 0;
    if (odd) {
        outlen = N;
        let auxMul0 = -1 * math.pi / N2;
        for (let i = 0; i < N2; i++) {
            pre_twiddle.push(math.exp(math.complex(0, auxMul0 * i)));
        }
        offset = 0.5;
    } else {
        outlen = N + 1;
        pre_twiddle = 1.0;
        offset = 0.0;
    }
    let post_twiddle = [];
    let auxMul1 = -1 * math.pi * n0 / N;
    for (let i = 0; i < outlen; i++) {
        post_twiddle.push(math.exp(math.complex(0, auxMul1 * (i + offset))));
    }

    X = []
    let auxMul2 = math.dotMultiply(x, pre_twiddle);
    for (let k = 0; k < N2; k++) {
        let auxMul3 = -2 * math.pi * k / (N * 2);
        X[k] = []
        for (let ii = 0; ii < N2; ii++) {
            X[k].push(math.dotMultiply(auxMul2[ii], math.exp(math.complex(0, auxMul3 * ii))))
        }
        X[k] = X[k].reduce((a, b) => math.add(a, b));
    }

    if (!odd) {
        X[0] *= math.sqrt(0.5);
        X[X.length - 1] *= math.sqrt(0.5);
    }

    return math.dotMultiply(math.dotMultiply(X.slice(0, X.length / 2), post_twiddle), math.sqrt(1 / N));
}

function imclt(X, odd = true) {
    if (!odd && X.length % 2 === 0) {
        throw "Even inverse CMDCT requires an odd number of coefficients"
    }

    // if (odd) {
    let N = X.length;
    let N2 = N * 2;
    let n0 = (N + 1) / 2;
    let post_twiddle = [];
    let auxMul0 = PI / N2;
    for (let i = 0; i < N2; i++) {
        post_twiddle.push(math.exp(math.complex(0, auxMul0 * (i + n0))));
    }

    let reversedX = _.cloneDeep(X);
    reversedX.reverse(); // reverse
    let Y1 = X;
    let Y2 = math.dotMultiply(-1, math.conj(reversedX));
    let Y = Y1.concat(Y2);
    // } else {
    //     // not odd not implemented
    // }

    let pre_twiddle = [];
    let auxMul1 = PI * n0 / N;
    for (let i = 0; i < N2; i++) {
        pre_twiddle.push(math.exp(math.complex(0, auxMul1 * i)));
    }

    let y = [];
    let auxMul2 = math.dotMultiply(Y, pre_twiddle);
    for (let k = 0; k < N2; k++) {
        let auxMul3 = PI2 * k / N2;
        y[k] = []
        for (let ii = 0; ii < N2; ii++) {
            y[k].push(math.dotDivide(math.dotMultiply(auxMul2[ii], math.exp(math.complex(0, auxMul3 * ii))), N2));
        }
        y[k] = math.sum(y[k]);
    }

    return math.re(math.dotMultiply(math.dotMultiply(y, post_twiddle), math.sqrt(N)));

}

function phmod(ph) {
    return ph < 0 ? PI2 + (ph % PI2) : ph % PI2
}

function unwrap(input, output) {
    const size = input.length
    if (!output) output = input
    if (output === true) output = new Array(size)

    let shift = 0
    let prev = phmod(input[0])
    output[0] = prev
    for (let i = 1; i < size; i++) {
        const current = phmod(input[i])
        const diff = current - prev
        if (diff < -PI) shift += PI2
        else if (diff > PI) shift -= PI2
        output[i] = current + shift
        prev = current
    }
    return output
}

function normalizeSpec(data, minVal, maxVal, minData, maxData) {
    let normArray = math.dotDivide(math.subtract(data, minData), (maxData - minData));
    normArray = math.add(math.dotMultiply(normArray, (maxVal - minVal)), minVal);
    return normArray
}

function denormalizeSpec(normData, minVal, maxVal, minData, maxData) {
    let array = math.dotDivide(math.subtract(normData, minVal), math.subtract(maxVal, minVal));
    array = math.add(math.dotMultiply(array, math.subtract(maxData, minData)), minData);
    return array;
}

function magphase(complexValue) {
    let angle = complexValue.arg();
    //let unwrappedPhase = unwrap(angle, true);
    let magnitude = complexValue.abs();
    let dbMag = 20 * math.log10(magnitude);
    return [dbMag, angle];
}

function arangeSpectrogram(spectrogram, type = "2D") {
    let spectrogramResult = []
    let magSpec = [];
    let phaseSpec = [];
    if (type === "2D") {
        for (let frame = 0; frame < spectrogram.length; frame++) {
            let magSpecAux = [];
            let phaseSpecAux = [];
            for (let index = 0; index < spectrogram[frame].length; index++) {
                let [mag, phase] = magphase(spectrogram[frame][index]);
                magSpecAux.push(mag);
                phaseSpecAux.push(phase);
            }

            let unwrappedPhase = unwrap(phaseSpecAux, true);
            // let magSpecAuxNorm = normalizeSpec(magSpecAux, 0, 1, -100, 0)
            // let unwrappedPhaseNorm = normalizeSpec(unwrappedPhase, 0, 1, -100, 100)
            magSpec.push(magSpecAux);
            phaseSpec.push(unwrappedPhase);
            // spectrogramResult.push(magSpecAuxNorm.concat(unwrappedPhaseNorm));
        }


        let magSpecNorm = normalizeSpec(magSpec, 0, 1, -100, 0)
        let unwrappedPhaseNorm = normalizeSpec(phaseSpec, 0, 1, -100, 100)

        spectrogramResult = magSpecNorm.concat(unwrappedPhaseNorm);
    }
    return spectrogramResult;
}

function convertPredictedSpectrogramIntoAudio(predictedSpec, type = "2D") {
    let magSpecNorm = predictedSpec.slice(0, predictedSpec.length / 2);
    let phaSpecNorm = predictedSpec.slice(predictedSpec.length / 2, predictedSpec.length);
    let magSpec = denormalizeSpec(magSpecNorm, 0, 1, -100, 0);
    let phaSpec = denormalizeSpec(phaSpecNorm, 0, 1, -100, 100);

    let reconstructedSpec = [];
    for (let frame = 0; frame < magSpec.length; frame++) {
        reconstructedSpec[frame] = [];
        for (let index = 0; index < magSpec[frame].length; index++) {
            let phase = math.complex(math.cos(phaSpec[frame][index][0]), math.sin(phaSpec[frame][index][0]));
            reconstructedSpec[frame].push(math.dotMultiply(math.dotPow(10, math.dotDivide(magSpec[frame][index][0], 20)), phase));
        }
    }

    let reconstructedSpecTransposed = reconstructedSpec[0].map((_, colIndex) => reconstructedSpec.map(row => row[colIndex]));

    let signal = ispectrogramMateo(reconstructedSpecTransposed);
    // Normalize signal to fit all the dynamic range TODO

    return signal;
}


function start() {


    //Leer audio por defecto para pruebas
    // loadJSON(function (data) {
    // // console.log(data)
    //     console.log("started")
    //     default_audio = data
    //     console.time('spectrogramMateo')
    //     let mcltSpec = spectrogramMateo(default_audio)
    //     console.timeEnd('spectrogramMateo')
    //     mcltspecCut = mcltSpec.slice(0, mcltSpec.length-1);
    //     mcltspecTransposed = mcltspecCut[0].map((_, colIndex) => mcltspecCut.map(row => row[colIndex]));
    //     // console.log(mcltspecTransposed)
    //     let mclt2Dspec = arangeSpectrogram(mcltspecTransposed)
    //     // console.log("Espectrograma chido")
    //     console.log(mclt2Dspec)
    //     // let mclt2Dspec = megadata;
    //     // mclt2Dspec = mclt2Dspec.slice(0, mclt2Dspec.length-1);
    //     // mclt2Dspec = mclt2Dspec[0].map((_, colIndex) => mclt2Dspec.map(row => row[colIndex])); // Transpose array to fit the model
    //
    //
    //     //Decoder step
    //     let tensor = tf.tensor2d(mclt2Dspec, [1024, 64], 'float32');
    //     let [mu_tensor, log_variance_tensor] = encoder_model.predict(tf.reshape(tensor, shape = [1, 1024, 64, 1]));
    //     let mu_latent_space = mu_tensor.dataSync();
    //     let log_variance_latent_space = log_variance_tensor.dataSync();
    //     let latent_space_size = mu_latent_space.length;
    //     // console.log(mu_latent_space)
    //     // console.log(log_variance_latent_space)
    //     // console.log(latent_space_size)
    //
    //     sampleValuesInLatentSpace = []
    //     for (let i = 0; i < latent_space_size; i++) {
    //         //sampleValuesInLatentSpace.push(sampleFromLatentSpace(mu_latent_space[i], log_variance_latent_space[i]));
    //         sampleValuesInLatentSpace.push(mu_latent_space[i]);
    //     }
    //     // console.log(sampleValuesInLatentSpace)
    //
    //     let decoder_tensor = tf.tensor(sampleValuesInLatentSpace);
    //     let predicted_spectogram_tensor = decoder_model.predict(tf.reshape(decoder_tensor, shape = [1, latent_space_size]));
    //     // console.log(predicted_spectogram_tensor)
    //     let predicted_spectrogram = predicted_spectogram_tensor.arraySync()
    //     predicted_spectrogram = predicted_spectrogram[0];
    //     let audio = convertPredictedSpectrogramIntoAudio(predicted_spectrogram);
    //
    //     console.log(audio);
    //     // send audio to GUI
    //
    // }, default_audio_query);
    //
    // return


    //const model = tf.sequential();

    // stop all audio
    audio_manager.stopAllBufferNodes();

    // get map descriptors
    setMapDescriptor();

    // update axis labels
    update_axis_labels()

    // Sounds
    sounds = [];
    n_pages_received = 0;
    all_loaded = false;

    // Canvas
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.addEventListener("mousedown", onMouseDown, false);
    canvas.addEventListener("mouseup", onMouseUp, false);
    canvas.addEventListener("mouseout", onMouseOut, false);
    canvas.addEventListener("wheel", onWheel, false);
    center_x = 0.5;
    center_y = 0.5;
    zoom_factor = 1.0;
    rotation_degrees = 0;

    // Display stuff
    if (w >= h) {
        disp_x_offset = (w - h) / 2;
        disp_y_offset = 0.0;
    } else {
        disp_x_offset = 0.0;
        disp_y_offset = (h - w) / 2;
    }

    // t-sne
    current_it_number = 0;
    var opt = {}
    opt.epsilon = epsilon; // epsilon is learning rate (10 = default)
    opt.perplexity = perplexity; // roughly how many neighbors each point influences (30 = default)
    opt.dim = 2; // dimensionality of the embedding (2 = default)
    tsne = new tsnejs.tSNE(opt); // create a tSNE instance

    //var online_offline_state = document.getElementById('myonoffswitch').checked;

    num_files = 3; // parseInt(document.getElementById('num_of_files').value, 10);
    n_pages = Math.round(num_files / 150) + 1;

    // n_pages = 3;
    //this is in online mode
    var query = document.getElementById('query_terms_input').value;

    // Search sounds in Freesound and start loading them
    if ((query == undefined) || (query == "")) {
        query = default_query;
    }

    for (let i = 0; i < n_pages; i++) {
        let url = "https://freesound.org/apiv2/search/text/?query=" + query + "&group_by_pack=0" +
            "&filter=duration:2" + "&page_size=150&fields=id,previews,name,analysis,url,username,images" +
            "&token=I7j6d2GhKndeNeAcJ4lnihzSpWP0YEQdfF2NSu6e&page=" + (i + 1);

        // "https://freesound.org/apiv2/search/text/?query=" + query + "&" +
        //     "group_by_pack=0&filter=duration:[0+TO+10]&fields=id,previews,name,analysis,url,username,images,ac_analysis" +
        //     extra_descriptors + "&page_size=150" +
        //     "&token=eecfe4981d7f41d2811b4b03a894643d5e33f812&page=" + (i + 1);
        loadJSON(function (data) {
            load_data_from_fs_json(data);
        }, url);
    }

    // if (online_offline_state) {
    //     console.log("freesound api")
    //     // how many pages to download
    //     // num_files = parseInt(document.getElementById('num_of_files').value, 10);
    //     // n_pages = Math.round(num_files / 150) + 1;
    //
    //
    //     // "https://freesound.org/apiv2/search/text/?query=" + query + "&" +
    //     //     "group_by_pack=0&filter=duration:[0+TO+10]&fields=id,previews,name,analysis,url,username,images,ac_analysis" +
    //     //     extra_descriptors + "&page_size=150" +
    //     //     "&token=I7j6d2GhKndeNeAcJ4lnihzSpWP0YEQdfF2NSu6e&page=" + (i + 1);
    // } else {
    //     // Set query to the json file
    //     var query = default_query;  //document.getElementById('query_terms_input').value;
    //     // Get variables for the source type and reverberance
    //     var source_type = document.getElementById('source_selector').value;
    //     var reverb_type = document.getElementById('reverb_selector').value;
    //
    //     // Load the json file
    //     // TODO: carg
    //     //  ar datos de la api de freesound
    //     loadJSON(function (data) {
    //         load_data_from_fs_json(data, source_type, reverb_type);
    //     }, query);
    //     n_pages = 1; // set n_pages to 1 as we only load one file, a hangover from freesound searching
    //     document.getElementById('info_placeholder').innerHTML = "Loading from file...";
    // }
}

window.requestAnimFrame = (function () { // This is called when code reaches this point
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

// Add the number of variables in latent space to html select tag items
function initLantentSpaceVariableSelector(latentSpaceDimension) { // This is called when code reaches this point
    let xSelector = document.getElementById('x_axis_map_descriptors_selector');
    let ySelector = document.getElementById('y_axis_map_descriptors_selector');
    for (let i = 1; i <= latentSpaceDimension; i++) {
        let optX = document.createElement('option');
        optX.value = String(i);
        optX.innerHTML = "Dimension " + i;
        let optY = document.createElement('option');
        optY.value = String(i);
        optY.innerHTML = "Dimension " + i;
        xSelector.appendChild(optX);
        ySelector.appendChild(optY);
    }
}

(async function init() { // This is called when code reaches this point
    window.addEventListener("keydown", onKeyDown, false);
    window.addEventListener("keyup", onKeyUp, false);
    // get encoder tensorflow model
    // encoderModel = await tf.loadLayersModel('https://models.seamosrealistas.com/encoder_model/model.json');
    // // get decoder tensorflow model
    // decoderModel = await tf.loadLayersModel('https://models.seamosrealistas.com/decoder_model/model.json');
    // Add the number of variables in latent space to html select tag items
    initLantentSpaceVariableSelector(encoderModel.outputShape[0][1]);
    setMapDescriptor();
    update_axis_labels();
})();

(function loop() {  // This is called when code reaches this point
    // Get sound's xy position and scale it smoothly to create an animation effect
    if ((all_loaded == true) && (current_it_number <= max_xy_iterations)) {
        document.getElementById('info_placeholder').innerHTML = 'Projecting sounds...';
        for (i in sounds) {
            var sound = sounds[i];
            sound.x = sound.computed_x * Math.pow(100, current_it_number / max_xy_iterations - 1) + 0.5 * (1 - Math.pow(100, current_it_number / max_xy_iterations - 1)); // Smooth position at the beginning
            sound.y = sound.computed_y * Math.pow(100, current_it_number / max_xy_iterations - 1) + 0.5 * (1 - Math.pow(100, current_it_number / max_xy_iterations - 1)); // Smooth position at the beginning
        }
        current_it_number += 1;
    }
    if (current_it_number >= max_xy_iterations - 1) {
        document.getElementById('info_placeholder').innerHTML = "Done, " + sounds.length + " sounds loaded!";
    }
    // console.log("loop")

    draw();
    requestAnimFrame(loop);
})();


/* Sounds stuff */

function SoundFactory(id, preview_url, analysis, url, name, username, image) {
    this.x = Math.random();
    this.y = Math.random();
    this.rad = 15;
    this.mod_position = Math.random();
    this.mod_inc = 0.1;
    this.mod_amp = default_point_modulation;
    this.selected = false;

    this.id = id;
    this.preview_url = preview_url;
    this.analysis = analysis;

    // Set color of the points
    // var color = rgbToHex(
    //     Math.floor(255 * analysis['sfx']['tristimulus']['mean'][0]),
    //     Math.floor(255 * analysis['sfx']['tristimulus']['mean'][1]),
    //     Math.floor(255 * analysis['sfx']['tristimulus']['mean'][2])
    // )
    var color = rgbToHex(255, 255, 255)
    this.rgba = color;

    this.url = url;
    this.name = name;
    this.username = username;
    this.image = image;
}

async function load_model_from_local_json(data) {
    model = tf.loadLayersModel(data);
    console.log('hei po dai')
}

function load_data_from_fs_json(data) {
    let x = [];
    let y = [];
    for (i in data['results']) {
        console.log(data)
        var sound_json = data['results'][i];
        var sound = new SoundFactory(
            id = sound_json['id'],
            preview_url = sound_json['audio'] || sound_json['previews']['preview-lq-mp3'],
            analysis = sound_json['analysis'],
            url = sound_json['url'],
            name = sound_json['name'],
            username = sound_json['username'],
            image = sound_json['image'] || sound_json['images']['spectral_m'],
        );
        sounds.push(sound);

        x.push(Math.random() * 5); // TODO get model latent space dim
        y.push(Math.random() * 5); // TODO get model latent space dim
    }

    map_xy_x_max = Math.max.apply(null, x);
    map_xy_x_min = Math.min.apply(null, x);
    map_xy_y_max = Math.max.apply(null, y);
    map_xy_y_min = Math.min.apply(null, y);

    for (i in sounds) {
        sounds[i].computed_x = (x[i] - map_xy_x_min) / (map_xy_x_max - map_xy_x_min);
        sounds[i].computed_y = 1 - (y[i] - map_xy_y_min) / (map_xy_y_max - map_xy_y_min);
    }

    all_loaded = true;
    console.log('Loaded map with ' + sounds.length + ' sounds');
}

function checkSelectSound(x, y) {
    var min_dist = 9999;
    var selected_sound = false;
    for (i in sounds) {
        var sound = sounds[i];
        var dist = computeEuclideanDistance(sound.x, sound.y, x, y);
        if (dist < min_dist) {
            min_dist = dist;
            selected_sound = sound;
        }
    }

    if (min_dist < 0.01) {
        if (!selected_sound.selected) {
            selectSound(selected_sound);
        }
    }
}

function selectSound(selected_sound) {

    if (!selected_sound.selected) {
        selected_sound.selected = true;
        selected_sound.mod_amp = 5.0;
        if (MONO_MODE) {
            audio_manager.stopAllBufferNodes();
        }
        audio_manager.loadSound(selected_sound.id, selected_sound.preview_url);
        showSoundInfo(selected_sound);
        last_selected_sound_id = selected_sound['id']
    } else {
        selected_sound.selected = false;
        selected_sound.mod_amp = default_point_modulation;
    }
}

function finishPlayingSound(sound_id) {
    var sound = getSoundFromId(sound_id);
    sound.selected = false;
    sound.mod_amp = default_point_modulation;
}

function selectSoundFromId(sound_id) {
    var sound = getSoundFromId(sound_id);
    selectSound(sound);
}

function getSoundFromId(sound_id) {
    for (i in sounds) {
        var sound = sounds[i];
        if (sound.id == parseInt(sound_id)) {
            return sound;
        }
    }
}

function showSoundInfo(sound) {
    var html = '';
    if ((sound.image !== undefined) && (sound.image !== '')) {
        html += '<img src="' + sound.image + '"/ class="sound_image"><br>';
    }
    html += sound.name + ' by <a href="' + sound.url + '" target="_blank">' + sound.username + '</a>';
    document.getElementById('sound_info_box').innerHTML = html;
}

function setMapDescriptor() {
    // var selected_descriptors = document.getElementById('map_descriptors_selector').value;
    //
    // The following is used when querying Freesound to decide which descriptors to include in the response
    // if (selected_descriptors.startsWith("tsne&")) {
    //     map_type = "tsne";
    //     extra_descriptors = selected_descriptors.split('&')[1];
    //     map_features = [extra_descriptors];
    // } else if (selected_descriptors.startsWith("xy&")) {
    //     map_type = "xy";
    //     extra_descriptors = selected_descriptors.split('&')[1] + ',' + selected_descriptors.split('&')[2];
    //     map_features = [selected_descriptors.split('&')[1], selected_descriptors.split('&')[2]];
    // }  else {
    map_type = "xy";
    var x_descriptor = document.getElementById('x_axis_map_descriptors_selector').value;
    var y_descriptor = document.getElementById('y_axis_map_descriptors_selector').value;
    map_features = [x_descriptor, y_descriptor];

    // }
}

/* Drawing */

function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (i in sounds) {
        var sound = sounds[i];
        var disp_x, disp_y;
        [disp_x, disp_y] = normCoordsToDisplayCoords(sound.x, sound.y)

        if (!sound.selected) {
            ctx.fillStyle = sound.rgba;
            ctx.strokeStyle = sound.rgba;
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#ffffff';
        }

        if (last_selected_sound_id == sound['id']) {
            ctx.fillStyle = '#ffffff';
        }

        ctx.beginPath();
        ctx.arc(disp_x, disp_y, sound.rad * zoom_factor * Math.pow(0.9, zoom_factor), 0, Math.PI * 2, true);
        ctx.fill();
        ctx.closePath();

        ctx.beginPath();
        ctx.arc(disp_x, disp_y, (sound.rad + 5 + (sound.mod_amp * Math.cos(sound.mod_position))) * zoom_factor * Math.pow(0.9, zoom_factor), 0, Math.PI * 2, true);
        ctx.stroke();
        ctx.closePath();

        sound.mod_position += sound.mod_inc;
    }
}

// form submit event handler
(function () {
    var formSubmitHandler = function formSubmitHandler(event) {
        event.preventDefault();
        start();
    }
    document.getElementById('query-form').onsubmit = formSubmitHandler;
})()

// axis text label drawing
function update_axis_labels() {
    console.log(map_features)
    // var nice_x_text = convert_to_nice_string(map_features[0])
    // var nice_y_text = convert_to_nice_string(map_features[1])


    // update the text boxes
    document.getElementById('x_axis_box').innerHTML = map_features[0];
    document.getElementById('y_axis_box').innerHTML = map_features[1];

}

// convert text in the form timbral.brightness to Brightness
function convert_to_nice_string(axis_string) {
    // convert to array at the dot
    var str = axis_string.split(".")
    // remove the timbral component
    var nice_str = str[1]
    // return the attribute with first letter as uppercase
    return nice_str.charAt(0).toUpperCase() + nice_str.slice(1);

}
