import React from 'react';
import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Post-processing pipeline for the 3D scene.
 * - Bloom: Makes the ball glow and court lines pop
 * - Vignette: Cinematic darkened edges
 * - ToneMapping: Better color handling
 */
export const Effects: React.FC = React.memo(() => {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.4}
        luminanceThreshold={0.8}
        luminanceSmoothing={0.5}
        mipmapBlur
      />
      <Vignette
        offset={0.3}
        darkness={0.6}
        eskil={false}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
});

Effects.displayName = 'Effects';
