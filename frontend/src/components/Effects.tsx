import React from 'react';
import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
  ChromaticAberration,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Vector2 } from 'three';

export const Effects: React.FC = React.memo(() => {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.75}
        luminanceSmoothing={0.45}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new Vector2(0.0007, 0.0007)}
        radialModulation={true}
        modulationOffset={0.2}
      />
      <Vignette
        offset={0.25}
        darkness={0.65}
        eskil={false}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
});

Effects.displayName = 'Effects';
