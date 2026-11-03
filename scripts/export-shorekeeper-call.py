"""Export the Shorekeeper Blender rig for the call renderer.

Run with Blender 5.x: blender -b source.blend -P this_script -- model.glb idle.glb
The model GLB is deliberately external to the installer. Only idle.glb is bundled.
"""

import bpy
import os
import sys


args = sys.argv[sys.argv.index('--') + 1:]
model_path, idle_path = args[:2]
armature = bpy.data.objects['R2T1ShouanrenMd10011']
model_objects = [armature] + [obj for obj in armature.children if obj.type == 'MESH']

# glTF cannot serialize Blender's Shader-to-RGB and color-ramp nodes. Preserve
# the packed painted base textures, and reproduce the stepped light in Three.js.
for obj in model_objects:
    if obj.type != 'MESH':
        continue
    for slot in obj.material_slots:
        old = slot.material
        if old is None:
            continue
        material = bpy.data.materials.new(old.name + '_Call')
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        shader = nodes.new('ShaderNodeBsdfPrincipled')
        shader.inputs['Roughness'].default_value = 1
        shader.inputs['Metallic'].default_value = 0
        material.node_tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
        if 'Outline' in obj.name:
            shader.inputs['Base Color'].default_value = (0.055, 0.075, 0.14, 1)
            material.use_backface_culling = True
        else:
            image = None
            if old.use_nodes:
                candidates = [n.image for n in old.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] > 0]
                image = next((i for i in candidates if i.name.lower().endswith('_d.png')), candidates[0] if candidates else None)
            if image:
                texture = nodes.new('ShaderNodeTexImage')
                texture.image = image
                material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
                if 'Alpha' in old.name:
                    material.node_tree.links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
                    material.surface_render_method = 'DITHERED'
                    material.use_backface_culling = False
        slot.material = material

armature.animation_data_clear()
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in model_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=model_path,
    export_format='GLB',
    use_selection=True,
    export_animations=False,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_apply=False,
)
print('MODEL_EXPORTED', model_path, os.path.getsize(model_path))

# Export a pure armature animation. The matching bone names bind to the external
# GLB in Three.js, while this small motion file remains in the installer.
action = bpy.data.actions['Stand1']
armature.animation_data_create()
track = armature.animation_data.nla_tracks.new()
track.name = 'ShorekeeperIdle'
track.strips.new('Stand1', int(action.frame_range[0]), action)
bpy.context.scene.frame_start = int(action.frame_range[0])
bpy.context.scene.frame_end = int(action.frame_range[1])
for obj in bpy.context.selected_objects:
    obj.select_set(False)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=idle_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_skins=False,
    export_materials='NONE',
)
print('IDLE_EXPORTED', idle_path, os.path.getsize(idle_path))
