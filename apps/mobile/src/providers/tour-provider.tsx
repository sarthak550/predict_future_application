import { createContext, useCallback, useContext, useState } from "react";
import { SpotlightTour, type TourStep } from "@/components/spotlight-tour";

type TourContextValue = {
  startTour: (steps: TourStep[]) => void;
};

const TourContext = createContext<TourContextValue>({ startTour: () => {} });

export function useTour(): TourContextValue {
  return useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [visible, setVisible] = useState(false);

  const startTour = useCallback((s: TourStep[]) => {
    setSteps(s);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <TourContext.Provider value={{ startTour }}>
      {children}
      <SpotlightTour visible={visible} steps={steps} onClose={close} />
    </TourContext.Provider>
  );
}
