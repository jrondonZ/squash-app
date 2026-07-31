module Api
  # Matchmaking. Create a room, read a room, join a room — that is the whole
  # surface. Everything else happens peer to peer over MatchChannel.
  class RoomsController < ApplicationController
    rescue_from ActiveRecord::RecordNotFound, with: :not_found
    rescue_from ActiveRecord::RecordInvalid, with: :unprocessable

    def create
      room = Room.open!(
        host_name: params.require(:host_name),
        host_character: params.require(:host_character)
      )
      render json: room, status: :created
    end

    def show
      render json: find_room
    end

    def join
      room = find_room

      # Two people can tap Join on the same code at the same moment; the row
      # lock makes the second one lose rather than silently overwriting the first.
      room.with_lock do
        raise Room::AlreadyFull if room.full?

        room.join!(
          guest_name: params.require(:guest_name),
          guest_character: params.require(:guest_character)
        )
      end

      # Tell the host, who is sitting on the lobby screen waiting.
      ActionCable.server.broadcast(
        room.stream_name,
        { t: "join", name: room.guest_name, character: room.guest_character }
      )

      render json: room
    rescue Room::AlreadyFull
      render json: { error: "That room already has two players." }, status: :conflict
    end

    private

    def find_room
      Room.find_by!(code: params[:code].to_s.upcase)
    end

    def not_found
      render json: { error: "No room with that code." }, status: :not_found
    end

    def unprocessable(error)
      render json: { error: error.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end
end
