---
license: mit
---

# Demucs OpenVINO

This repo stores OpenVINO(TM) models in IR format that are used to perform Music Separation.

Currently, the models stored here (htdemucs_fwd.xml, htdemucs_fwd.bin) is a conversion of the Demucs v4 model, with some 'outer' operations (such as stft, istft) stripped out.  

This model stores the model conversions for the following six configurations:
* HTDemucs v4
* HTDemucs FT (fine-tuned) Bass
* HTDemucs FT (fine-tuned) Drums
* HTDemucs FT (fine-tuned) Other
* HTDemucs FT (fine-tuned) Vocals
* HTDemucs v4 6S (6-Stem)

This is intended to be used with the set of OpenVINO-based AI plugins for Audacity(R), here: https://github.com/intel/openvino-plugins-ai-audacity

More specifically, see details of pure-C++ implementation of the htdemucs pipeline here: https://github.com/intel/openvino-plugins-ai-audacity/blob/main/mod-openvino/htdemucs.cpp

This pipeline was ported from htdemucs.py, found here: https://github.com/facebookresearch/demucs

# Citations:
```
@inproceedings{rouard2022hybrid,
  title={Hybrid Transformers for Music Source Separation},
  author={Rouard, Simon and Massa, Francisco and D{\'e}fossez, Alexandre},
  booktitle={ICASSP 23},
  year={2023}
}

@inproceedings{defossez2021hybrid,
  title={Hybrid Spectrogram and Waveform Source Separation},
  author={D{\'e}fossez, Alexandre},
  booktitle={Proceedings of the ISMIR 2021 Workshop on Music Source Separation},
  year={2021}
}
```

## Intel’s Human Rights Disclaimer:
Intel is committed to respecting human rights and avoiding complicity in human rights abuses. See Intel's Global Human Rights Principles. Intel's products and software are intended only to be used in applications that do not cause or contribute to a violation of an internationally recognized human right. 