export const onInitialize = async ({
  onComplete,
}: {
  accessToken: string;
  apiUrl: string;
  onComplete?: () => void;
}) => {
  window.dispatchEvent(new CustomEvent("openTelegramConnect"));

  if (onComplete) {
    onComplete();
  }
};
