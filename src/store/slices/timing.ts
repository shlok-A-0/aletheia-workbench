import type { StateCreator } from 'zustand';
import type { Waveform, StimulusEvent } from '../../engine/types';

export interface TimingSlice {
  waveform: Waveform | null;
  stimulus: StimulusEvent[];
  clockPeriod: number;
  totalDuration: number;
  setWaveform: (waveform: Waveform | null) => void;
  setStimulus: (stimulus: StimulusEvent[]) => void;
  addStimulusEvent: (event: StimulusEvent) => void;
  setClockPeriod: (clockPeriod: number) => void;
  setTotalDuration: (totalDuration: number) => void;
  resetTiming: () => void;
}

export const createTimingSlice: StateCreator<TimingSlice, [], [], TimingSlice> = (set) => ({
  waveform: null,
  stimulus: [],
  clockPeriod: 20,
  totalDuration: 100,
  setWaveform: (waveform) => set({ waveform }),
  setStimulus: (stimulus) => set({ stimulus }),
  addStimulusEvent: (event) =>
    set((state) => ({
      stimulus: [...state.stimulus, event].sort((a, b) => a.t - b.t),
    })),
  setClockPeriod: (clockPeriod) => set({ clockPeriod }),
  setTotalDuration: (totalDuration) => set({ totalDuration }),
  resetTiming: () => set({ waveform: null, stimulus: [], clockPeriod: 20, totalDuration: 100 }),
});
