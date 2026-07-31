# The peer-to-peer relay for an online match.
#
# This channel deliberately knows nothing about squash. It does not validate
# scores, adjudicate lets or track the ball — the host browser is authoritative
# for all of that. Its entire job is to forward a payload from one peer in a
# room to the other, as fast as it can.
#
# Keeping the server out of the simulation is what makes the game feel
# responsive: a rally is decided by physics running locally at 60 Hz, not by a
# round trip to Rails.
class MatchChannel < ApplicationCable::Channel
  # Snapshots are the largest thing that crosses the wire. Anything much bigger
  # than a full world state is not something this channel should be carrying.
  MAX_PAYLOAD_BYTES = 96 * 1024

  def subscribed
    room = Room.find_by(code: params[:room].to_s.upcase)
    return reject unless room

    @room = room
    stream_from room.stream_name
  end

  def unsubscribed
    return unless @room

    # Let the other peer know the court is empty, so they are not left waiting.
    ActionCable.server.broadcast(@room.stream_name, { t: "leave" })
  end

  # Forward a message to everyone else on this room's stream.
  def relay(data)
    return unless @room

    payload = data["payload"]
    return if payload.blank?
    return if payload.to_s.bytesize > MAX_PAYLOAD_BYTES

    @room.touch(:last_seen_at) if throttled_touch?

    ActionCable.server.broadcast(@room.stream_name, payload)
  end

  private

  # `last_seen_at` only exists so stale rooms can be reaped. Writing it on every
  # relay would mean a database round trip per snapshot, twenty times a second.
  def throttled_touch?
    return false if @room.last_seen_at && @room.last_seen_at > 30.seconds.ago

    true
  end
end
