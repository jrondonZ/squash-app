Rails.application.routes.draw do
  namespace :api, defaults: { format: :json } do
    resources :rooms, only: %i[create show], param: :code do
      post :join, on: :member
    end

    resources :matches, only: %i[index create]
    get "ladder", to: "ladder#index"
  end

  # ActionCable carries the peer-to-peer relay for online matches.
  mount ActionCable.server => "/cable"

  # Reveal health status on /up that returns 200 if the app boots with no
  # exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  # The client is a single-page app built into public/. Anything that is not the
  # API, the cable, or a real file on disk is a client-side route, so serve the
  # built index and let the browser take over.
  root "spa#index"
  get "*path", to: "spa#index", constraints: ->(request) { request.format.html? }
end
