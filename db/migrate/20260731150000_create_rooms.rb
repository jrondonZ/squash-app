# Rooms are the matchmaking primitive: a short code two people can share so
# their browsers end up on the same ActionCable stream. They are ephemeral —
# nothing about a room needs to outlive the match it was created for.
class CreateRooms < ActiveRecord::Migration[8.1]
  def change
    create_table :rooms do |t|
      t.string :code, null: false
      t.string :host_name, null: false
      t.string :guest_name
      t.string :host_character, null: false
      t.string :guest_character
      # Shared seed, so both peers construct an identical simulation.
      t.string :seed, null: false
      t.string :status, null: false, default: "waiting"
      t.datetime :last_seen_at

      t.timestamps
    end

    add_index :rooms, :code, unique: true
    add_index :rooms, %i[status created_at]
  end
end
