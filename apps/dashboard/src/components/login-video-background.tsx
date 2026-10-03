import LoginTestimonials from "./login-testimonials";

export function LoginVideoBackground() {
  return (
    <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden m-2">
      <img
        src="/assets/bg-login.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover dark:hidden"
        aria-hidden="true"
      />
      <img
        src="/assets/bg-login-dark.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover hidden dark:block"
        aria-hidden="true"
      />

      {/* Overlay for better text readability */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col justify-center items-center p-2 text-center h-full w-full">
        <div className="max-w-lg">
          <LoginTestimonials />
        </div>
      </div>
    </div>
  );
}
